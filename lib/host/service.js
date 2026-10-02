/**
 * `ctx.layaGoDecision`: one decision service over the Laya Go Launcher.
 *
 * The service is the plugin's real API. The model-facing tools are thin
 * projections of it, and another plugin can inject `layaGoDecision` and call
 * `decide` directly. It owns everything the tools should not each re-implement:
 * question validation, the state-size guard, the concurrency cap, readiness of
 * the launcher, and the projection of a Laya answer into "certain" and
 * "uncertain" buckets that a caller can act on without knowing entropy
 * semantics.
 *
 * @module dsh-laya-go-decision/host/service
 */
import { Service } from '@deepseek-ai/cordis';
import { LayaClient } from "./client.js";
import { LayaGoError } from "./errors.js";
/** Maximum accepted length of a question id. */
const MAX_QUESTION_ID = 64;
/** A counting semaphore that hands the slot over directly, so the cap is exact. */
class Semaphore {
    limit;
    active = 0;
    waiters = [];
    /**
     * @param limit - maximum concurrent holders.
     */
    constructor(limit) {
        this.limit = limit;
    }
    /** Wait for a slot. */
    async acquire() {
        if (this.active < this.limit) {
            this.active += 1;
            return;
        }
        await new Promise((resolve) => { this.waiters.push(resolve); });
    }
    /** Release a slot, handing it to the next waiter when one is queued. */
    release() {
        const next = this.waiters.shift();
        if (next === undefined)
            this.active -= 1;
        else
            next();
    }
    /**
     * Run one task inside the cap.
     * @param task - the work to serialize.
     * @returns the task's result.
     */
    async run(task) {
        await this.acquire();
        try {
            return await task();
        }
        finally {
            this.release();
        }
    }
}
/** Validate one non-empty string field. */
function requireText(value, what) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new LayaGoError('invalid_questions', `${what} must be a non-empty string`);
    }
    return value;
}
/**
 * Validate caller-written questions and translate them into the Laya wire shape.
 * The checks mirror what the launcher itself rejects, but they name the offending
 * question instead of failing the whole request with a 400.
 * @param questions - questions as the caller wrote them.
 * @param maxQuestions - configured cap for one forward pass.
 * @returns the question map keyed by id.
 * @throws LayaGoError `invalid_questions` for anything unusable.
 */
export function parseQuestions(questions, maxQuestions) {
    if (!Array.isArray(questions) || questions.length === 0) {
        throw new LayaGoError('invalid_questions', 'at least one question is required', {
            hint: 'One forward pass answers every question; put them all in one call.',
        });
    }
    if (questions.length > maxQuestions) {
        throw new LayaGoError('invalid_questions', `${questions.length} questions exceed the configured maximum of ${maxQuestions}`, {
            hint: 'Split the call, or raise maxQuestions.',
        });
    }
    const result = {};
    for (const [index, question] of questions.entries()) {
        const where = `questions[${index}]`;
        const id = requireText(question.id, `${where}.id`);
        if (id.length > MAX_QUESTION_ID) {
            throw new LayaGoError('invalid_questions', `${where}.id is longer than ${MAX_QUESTION_ID} characters`);
        }
        if (Object.hasOwn(result, id)) {
            throw new LayaGoError('invalid_questions', `duplicate question id ${JSON.stringify(id)}`, {
                hint: 'Question ids key the answers, so each one must be unique.',
            });
        }
        const declaredType = question.type;
        if (declaredType !== 'choice' && declaredType !== 'score' && declaredType !== 'noul') {
            throw new LayaGoError('invalid_questions', `${where}.type must be choice, score, or noul, got ${JSON.stringify(declaredType)}`);
        }
        // Narrowing `unknown` by inequality only proves the value is one of the three
        // literals checked just above, so the assertion is the validated value.
        const type = declaredType;
        const instructions = requireText(question.instructions, `${where}.instructions`);
        if (type === 'noul') {
            if (question.criteria !== undefined) {
                throw new LayaGoError('invalid_questions', `${where}.criteria must be omitted for a noul question`, {
                    hint: 'A noul question is answered yes/no; put the yes/no question in instructions.',
                });
            }
            result[id] = { type, instructions };
            continue;
        }
        if (type === 'choice') {
            const criteria = question.criteria;
            if (typeof criteria !== 'object' || criteria === null || Array.isArray(criteria)) {
                throw new LayaGoError('invalid_questions', `${where}.criteria must be a label-to-description object for a choice question`, {
                    hint: 'Example: { "billing": "invoices, payments, refunds", "technical": "bugs, outages" }.',
                });
            }
            const entries = Object.entries(criteria);
            if (entries.length === 0) {
                throw new LayaGoError('invalid_questions', `${where}.criteria must contain at least one label`);
            }
            const normalized = {};
            for (const [label, description] of entries) {
                if (label.trim() === '' || typeof description !== 'string' || description.trim() === '') {
                    throw new LayaGoError('invalid_questions', `${where}.criteria["${label}"] must be a non-empty description`);
                }
                normalized[label] = description;
            }
            result[id] = { type, instructions, criteria: normalized };
            continue;
        }
        const criteria = question.criteria;
        if (!Array.isArray(criteria)) {
            throw new LayaGoError('invalid_questions', `${where}.criteria must be an array of level descriptions for a score question`, {
                hint: 'Order the levels low to high, for example ["not urgent", "soon", "critical"].',
            });
        }
        if (criteria.length < 2) {
            throw new LayaGoError('invalid_questions', `${where}.criteria needs at least two levels`);
        }
        const levels = [];
        for (const level of criteria) {
            levels.push(requireText(level, `${where}.criteria level`));
        }
        result[id] = { type, instructions, criteria: levels };
    }
    return result;
}
/** The plugin's decision service, registered as `ctx.layaGoDecision`. */
export class LayaGoDecisionService extends Service {
    /** The runtime this service drives. */
    runtime;
    semaphore;
    /**
     * @param ctx - context whose fiber owns the service registration.
     * @param runtime - normalized config, HTTP client, and process supervisor.
     */
    constructor(ctx, runtime) {
        super(ctx, 'layaGoDecision');
        this.runtime = runtime;
        this.semaphore = new Semaphore(runtime.config.maxConcurrent);
    }
    /** Normalized plugin configuration. */
    get config() {
        return this.runtime.config;
    }
    /** Replace the runtime after a volatile config update, disposing the old launcher first. */
    async replaceRuntime(next) {
        const previous = this.runtime.supervisor;
        if (previous !== next.supervisor)
            await previous.dispose();
        this.runtime.config = next.config;
        this.runtime.client = next.client;
        this.runtime.supervisor = next.supervisor;
    }
    /**
     * Answer typed questions about one state in a single forward pass.
     * @param state - the text to decide about.
     * @param questions - the questions to answer.
     * @param signal - caller cancellation.
     * @returns every answer plus the uncertainty split.
     * @throws LayaGoError for unusable input or a failed launcher interaction.
     */
    async decide(state, questions, signal) {
        const config = this.runtime.config;
        if (typeof state !== 'string' || state.trim() === '') {
            throw new LayaGoError('invalid_questions', 'state must be a non-empty string', {
                hint: 'Pass the text the questions are about.',
            });
        }
        if (state.length > config.maxStateChars) {
            throw new LayaGoError('state_too_large', `state is ${state.length} characters, over the configured maximum of ${config.maxStateChars}`, {
                hint: 'Summarize the state first; Laya truncates long inputs from the right and would silently drop the newest information.',
            });
        }
        const specs = parseQuestions(questions, config.maxQuestions);
        const ready = await this.prepare(signal);
        const response = await this.semaphore.run(() => this.runtime.client.predict({ state, questions: specs }, { signal }));
        const warnings = [];
        const answers = [];
        // Iterating the validated specs keeps the caller's question order and gives
        // the id a `string` type; the raw inputs may still hold `unknown` ids.
        for (const [id, spec] of Object.entries(specs)) {
            const answer = response.answers[id];
            if (answer === undefined) {
                warnings.push(`the launcher returned no answer for ${JSON.stringify(id)}`);
                continue;
            }
            if (answer.type !== spec.type) {
                warnings.push(`question ${JSON.stringify(id)} asked for ${spec.type} but was answered as ${answer.type}`);
            }
            const certain = answer.confidence >= config.confidenceThreshold;
            answers.push({
                id,
                type: answer.type,
                ...answer.choice === undefined ? {} : { choice: answer.choice },
                ...answer.score === undefined ? {} : { score: answer.score },
                ...answer.legend === undefined ? {} : { legend: answer.legend },
                ...answer.noul === undefined ? {} : { noul: answer.noul },
                ...answer.probabilities === undefined ? {} : { probabilities: answer.probabilities },
                ...answer.action?.actProbability === undefined ? {} : { actProbability: answer.action.actProbability },
                confidence: answer.confidence,
                certain,
            });
        }
        return {
            model: response.model,
            answers,
            uncertain: answers.filter(answer => !answer.certain).map(answer => answer.id),
            usage: response.usage,
            timing: response.timing,
            server: {
                mode: config.mode,
                baseUrl: config.baseUrl,
                started: ready.started,
                adopted: ready.adopted,
            },
            warnings,
        };
    }
    /**
     * Read-only report: what answers here, what is loaded, and how the counters look.
     * Never throws for an unreachable launcher; that is a fact the caller wants.
     * @param signal - caller cancellation.
     * @returns the launcher status.
     */
    async status(signal) {
        const config = this.runtime.config;
        const server = this.runtime.supervisor.snapshot();
        const probe = await this.runtime.client.probe(signal);
        if (probe.kind === 'absent') {
            return {
                reachable: false,
                mode: config.mode,
                baseUrl: config.baseUrl,
                server,
                error: {
                    code: 'unreachable',
                    message: `no Laya service answered at ${config.baseUrl}`,
                    hint: config.mode === 'managed'
                        ? 'Use laya_go_server with action "start" to launch it.'
                        : 'Start the launcher yourself; mode is "external".',
                },
            };
        }
        if (probe.kind === 'foreign') {
            return {
                reachable: false,
                mode: config.mode,
                baseUrl: config.baseUrl,
                server,
                error: {
                    code: 'start_failed',
                    message: `${config.baseUrl} answered, but not as a Laya launcher`,
                    hint: 'Something else is using that port; point baseUrl at the launcher or free the port.',
                },
            };
        }
        const [load, metrics] = await Promise.all([
            this.runtime.client.loadState({ signal }).catch(() => undefined),
            this.runtime.client.metrics({ signal }).catch(() => undefined),
        ]);
        return {
            reachable: true,
            mode: config.mode,
            baseUrl: config.baseUrl,
            server: this.runtime.supervisor.snapshot(),
            health: probe.health,
            ...load === undefined ? {} : { load },
            ...metrics === undefined ? {} : { metrics },
        };
    }
    /**
     * Make the launcher ready now, starting a managed process when needed.
     * @param signal - caller cancellation.
     * @returns the ready launcher's report.
     */
    async startServer(signal) {
        const outcome = await this.runtime.supervisor.ensureReady(signal);
        return {
            ready: true,
            started: outcome.started,
            adopted: outcome.adopted,
            server: this.runtime.supervisor.snapshot(),
            ...outcome.load === undefined ? {} : { load: outcome.load },
            ...outcome.health === undefined ? {} : { health: outcome.health },
        };
    }
    /**
     * Stop the launcher this plugin started.
     * @param signal - caller cancellation.
     * @returns whether a process was terminated.
     */
    async stopServer(signal) {
        const outcome = await this.runtime.supervisor.stop(signal);
        return { stopped: outcome.stopped, forced: outcome.forced, server: this.runtime.supervisor.snapshot() };
    }
    /** Release the managed process. Never throws. */
    async dispose() {
        await this.runtime.supervisor.dispose();
    }
    /** Ready the launcher according to `mode` and `autoStart`. */
    async prepare(signal) {
        const config = this.runtime.config;
        if (config.mode === 'managed' && config.autoStart) {
            return this.runtime.supervisor.ensureReady(signal);
        }
        return this.runtime.supervisor.requireReady(signal);
    }
}
//# sourceMappingURL=service.js.map