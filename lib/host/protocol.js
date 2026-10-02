/**
 * The slice of the Laya Go Launcher HTTP contract this plugin consumes.
 *
 * The documented surface is `docs/api.md` in Laya-Go-Launcher; these types keep
 * the field names the server actually sends (`snake_case` on the wire, camelCase
 * here) and the parsers below narrow an `unknown` JSON body into them. Parsing is
 * deliberately tolerant about fields the server may add, and strict only where a
 * missing value would make the answer meaningless.
 *
 * Optional members include `undefined` explicitly: the wire shape really does
 * carry "absent", and `exactOptionalPropertyTypes` keeps a parser from writing
 * `undefined` into a member that only ever means "the server omitted it".
 *
 * @module dsh-laya-go-decision/host/protocol
 */
import { LayaGoError } from "./errors.js";
/**
 * Narrow a decoded body to an object.
 * @param value - decoded JSON.
 * @returns the object, or undefined for anything else.
 */
export function asObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined;
}
/** Read a string field, ignoring other types. */
function readString(source, key) {
    const value = source[key];
    return typeof value === 'string' && value !== '' ? value : undefined;
}
/** Read a finite number field, ignoring other types. */
function readNumber(source, key) {
    const value = source[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
/** Read a boolean field, ignoring other types. */
function readBoolean(source, key) {
    const value = source[key];
    return typeof value === 'boolean' ? value : undefined;
}
/** Read a `{ key: number }` map, ignoring non-numeric members. */
function readNumberMap(source, key) {
    const value = asObject(source[key]);
    if (value === undefined)
        return undefined;
    const result = {};
    for (const [name, entry] of Object.entries(value)) {
        if (typeof entry === 'number' && Number.isFinite(entry))
            result[name] = entry;
    }
    return Object.keys(result).length === 0 ? undefined : result;
}
/** Read a `{ key: string }` map, ignoring non-string members. */
function readStringMap(source, key) {
    const value = asObject(source[key]);
    if (value === undefined)
        return undefined;
    const result = {};
    for (const [name, entry] of Object.entries(value)) {
        if (typeof entry === 'string')
            result[name] = entry;
    }
    return Object.keys(result).length === 0 ? undefined : result;
}
/**
 * Read the Laya error envelope out of an error response body.
 * @param value - decoded JSON body.
 * @returns the code and message, when the body carries them.
 */
export function parseErrorEnvelope(value) {
    const body = asObject(value);
    const error = body === undefined ? undefined : asObject(body['error']);
    if (error === undefined)
        return {};
    return { code: readString(error, 'code'), message: readString(error, 'message') };
}
/**
 * Parse `GET /api/v1/health`.
 * @param value - decoded JSON body.
 * @returns the health payload, with absent sections omitted.
 */
export function parseHealth(value) {
    const body = asObject(value);
    if (body === undefined) {
        throw new LayaGoError('bad_response', '/api/v1/health did not return a JSON object', {
            hint: 'Check that baseUrl points at the Laya launcher and not at a proxy or another service.',
        });
    }
    // Laya always reports `status`; requiring it is what lets an occupied port be
    // told apart from a launcher, instead of treating any JSON 200 as Laya.
    if (typeof body['status'] !== 'string') {
        throw new LayaGoError('bad_response', '/api/v1/health answered, but without a Laya status field', {
            hint: 'Something else is serving that port; point baseUrl at the launcher or free the port.',
        });
    }
    const backend = asObject(body['backend']);
    const onnx = backend === undefined ? undefined : asObject(backend['onnx']);
    const device = asObject(body['device']);
    const engine = asObject(body['engine']);
    return {
        status: readString(body, 'status'),
        version: readString(body, 'version'),
        ...backend === undefined ? {} : {
            backend: {
                requested: readString(backend, 'requested'),
                selected: readString(backend, 'selected'),
                note: readString(backend, 'note'),
                ...onnx === undefined ? {} : {
                    onnx: {
                        available: readBoolean(onnx, 'available'),
                        version: readString(onnx, 'version'),
                        error: readString(onnx, 'error'),
                    },
                },
            },
        },
        ...device === undefined ? {} : {
            device: {
                name: readString(device, 'name'),
                computeCapability: readString(device, 'compute_capability'),
                vramFreeMb: readNumber(device, 'vram_free_mb'),
                vramTotalMb: readNumber(device, 'vram_total_mb'),
            },
        },
        ...engine === undefined ? {} : {
            engine: {
                loaded: readBoolean(engine, 'loaded') ?? false,
                path: readString(engine, 'path'),
                backend: readString(engine, 'backend'),
                contexts: readNumber(engine, 'contexts'),
            },
        },
    };
}
/** The phases the launcher documents; anything else is reported as `idle`. */
const LOAD_PHASES = ['idle', 'loading', 'ready', 'failed'];
/**
 * Parse `GET /api/v1/load`.
 * @param value - decoded JSON body.
 * @returns the load state with its attempt list.
 */
export function parseLoadState(value) {
    const body = asObject(value);
    if (body === undefined) {
        throw new LayaGoError('bad_response', '/api/v1/load did not return a JSON object');
    }
    const rawPhase = readString(body, 'phase');
    const phase = (rawPhase !== undefined && LOAD_PHASES.includes(rawPhase) ? rawPhase : 'idle');
    const attempts = [];
    const rawAttempts = body['attempts'];
    if (Array.isArray(rawAttempts)) {
        for (const entry of rawAttempts) {
            const attempt = asObject(entry);
            if (attempt === undefined)
                continue;
            attempts.push({
                model: readString(attempt, 'model'),
                backend: readString(attempt, 'backend'),
                provider: readString(attempt, 'provider'),
                path: readString(attempt, 'path'),
                ok: readBoolean(attempt, 'ok'),
                skipped: readBoolean(attempt, 'skipped'),
                error: readString(attempt, 'error'),
                ms: readNumber(attempt, 'ms'),
            });
        }
    }
    return {
        phase,
        mode: readString(body, 'mode'),
        step: readString(body, 'step'),
        path: readString(body, 'path'),
        backend: readString(body, 'backend'),
        device: readString(body, 'device'),
        note: readString(body, 'note'),
        error: readString(body, 'error'),
        attempts,
    };
}
/**
 * Parse `POST /api/v1/predict`.
 * @param value - decoded JSON body.
 * @returns the answers plus usage and timing.
 * @throws LayaGoError `bad_response` when no answers are present.
 */
export function parsePredictResponse(value) {
    const body = asObject(value);
    const rawAnswers = body === undefined ? undefined : asObject(body['answers']);
    if (body === undefined || rawAnswers === undefined) {
        throw new LayaGoError('bad_response', '/api/v1/predict returned no answers object');
    }
    const answers = {};
    for (const [id, entry] of Object.entries(rawAnswers)) {
        const answer = asObject(entry);
        if (answer === undefined)
            continue;
        const action = asObject(answer['action']);
        answers[id] = {
            type: readString(answer, 'type') ?? 'unknown',
            confidence: readNumber(answer, 'confidence') ?? 0,
            choice: readString(answer, 'choice'),
            probabilities: readNumberMap(answer, 'probabilities'),
            ...action === undefined ? {} : { action: { actProbability: readNumber(action, 'act_probability') } },
            score: readNumber(answer, 'score'),
            legend: readStringMap(answer, 'legend'),
            noul: readNumber(answer, 'noul'),
        };
    }
    if (Object.keys(answers).length === 0) {
        throw new LayaGoError('bad_response', '/api/v1/predict returned an empty answers object');
    }
    const usage = body['usage'] === undefined ? undefined : asObject(body['usage']);
    const timing = body['timing'] === undefined ? undefined : asObject(body['timing']);
    return {
        model: readString(body, 'model'),
        answers,
        ...usage === undefined ? {} : {
            usage: {
                inputTokens: readNumber(usage, 'input_tokens'),
                outputTokens: readNumber(usage, 'output_tokens'),
            },
        },
        ...timing === undefined ? {} : {
            timing: {
                totalMs: readNumber(timing, 'total_ms'),
                tokenizeMs: readNumber(timing, 'tokenize_ms'),
                inferenceMs: readNumber(timing, 'inference_ms'),
            },
        },
    };
}
/**
 * Parse `GET /api/v1/metrics`.
 * @param value - decoded JSON body.
 * @returns the counters and latency percentiles the plugin reports.
 */
export function parseMetrics(value) {
    const body = asObject(value);
    if (body === undefined) {
        throw new LayaGoError('bad_response', '/api/v1/metrics did not return a JSON object');
    }
    const latency = asObject(body['latency_ms']);
    return {
        requestsTotal: readNumber(body, 'requests_total'),
        requestsFailed: readNumber(body, 'requests_failed'),
        predictTotal: readNumber(body, 'predict_total'),
        ...latency === undefined ? {} : {
            latency: {
                p50: readNumber(latency, 'p50'),
                p90: readNumber(latency, 'p90'),
                p99: readNumber(latency, 'p99'),
                min: readNumber(latency, 'min'),
                max: readNumber(latency, 'max'),
            },
        },
    };
}
//# sourceMappingURL=protocol.js.map