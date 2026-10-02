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
import { Service, type Context } from '@deepseek-ai/cordis';
import { LayaClient } from './client.ts';
import type { LayaGoMode, NormalizedConfig } from './config.ts';
import { type LayaGoErrorCode } from './errors.ts';
import type { LayaHealth, LayaLoadState, LayaMetrics, LayaQuestionSpec, LayaTiming, LayaUsage } from './protocol.ts';
import type { LayaServerSnapshot, LayaServerSupervisor } from './supervisor.ts';
/** One question as a caller writes it. Fields are untrusted until validated. */
export interface LayaQuestionInput {
    /** Stable id, echoed back in the answer. */
    readonly id: unknown;
    /** `choice` picks one label, `score` rates levels, `noul` answers yes/no. */
    readonly type: unknown;
    /** The question itself, in natural language. */
    readonly instructions: unknown;
    /** `choice`: label to description. `score`: level descriptions, low to high. `noul`: omit. */
    readonly criteria?: unknown;
}
/** One answered question. */
export interface LayaDecisionAnswer {
    readonly id: string;
    readonly type: string;
    /** Present for `choice`. */
    readonly choice?: string;
    /** Present for `score`. */
    readonly score?: number;
    /** Present for `score`: level index to description. */
    readonly legend?: Readonly<Record<string, string>>;
    /** Present for `noul`: the probability that the answer is yes. */
    readonly noul?: number;
    readonly probabilities?: Readonly<Record<string, number>>;
    /** Auxiliary action-head probability reported by the checkpoint. */
    readonly actProbability?: number;
    /** The launcher's normalized-entropy confidence for this question. */
    readonly confidence: number;
    /** `confidence >= confidenceThreshold`; advisory, not an accuracy claim. */
    readonly certain: boolean;
}
/** One complete decision over a state. */
export interface LayaDecisionResult {
    readonly model: string | undefined;
    readonly answers: readonly LayaDecisionAnswer[];
    /** Ids whose confidence fell below `confidenceThreshold`. */
    readonly uncertain: readonly string[];
    readonly usage: LayaUsage | undefined;
    readonly timing: LayaTiming | undefined;
    readonly server: {
        readonly mode: LayaGoMode;
        readonly baseUrl: string;
        /** True when this call started the launcher process. */
        readonly started: boolean;
        /** True when the call used a launcher this plugin did not start. */
        readonly adopted: boolean;
    };
    readonly warnings: readonly string[];
}
/** Read-only report about the launcher. */
export interface LayaStatusResult {
    readonly reachable: boolean;
    readonly mode: LayaGoMode;
    readonly baseUrl: string;
    readonly server: LayaServerSnapshot;
    readonly health?: LayaHealth;
    readonly load?: LayaLoadState;
    readonly metrics?: LayaMetrics;
    readonly error?: {
        readonly code: LayaGoErrorCode;
        readonly message: string;
        readonly hint?: string;
    };
}
/** Result of an explicit server start. */
export interface LayaServerStartResult {
    readonly ready: true;
    readonly started: boolean;
    readonly adopted: boolean;
    readonly server: LayaServerSnapshot;
    readonly load?: LayaLoadState;
    readonly health?: LayaHealth;
}
/** Result of an explicit server stop. */
export interface LayaServerStopResult {
    readonly stopped: boolean;
    readonly forced: boolean;
    readonly server: LayaServerSnapshot;
}
/** Everything the service needs from the plugin entry. */
export interface LayaRuntime {
    config: NormalizedConfig;
    client: LayaClient;
    supervisor: LayaServerSupervisor;
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
export declare function parseQuestions(questions: readonly LayaQuestionInput[], maxQuestions: number): Record<string, LayaQuestionSpec>;
/** The plugin's decision service, registered as `ctx.layaGoDecision`. */
export declare class LayaGoDecisionService extends Service {
    /** The runtime this service drives. */
    readonly runtime: LayaRuntime;
    private readonly semaphore;
    /**
     * @param ctx - context whose fiber owns the service registration.
     * @param runtime - normalized config, HTTP client, and process supervisor.
     */
    constructor(ctx: Context, runtime: LayaRuntime);
    /** Normalized plugin configuration. */
    get config(): NormalizedConfig;
    /** Replace the runtime after a volatile config update, disposing the old launcher first. */
    replaceRuntime(next: LayaRuntime): Promise<void>;
    /**
     * Answer typed questions about one state in a single forward pass.
     * @param state - the text to decide about.
     * @param questions - the questions to answer.
     * @param signal - caller cancellation.
     * @returns every answer plus the uncertainty split.
     * @throws LayaGoError for unusable input or a failed launcher interaction.
     */
    decide(state: string, questions: readonly LayaQuestionInput[], signal?: AbortSignal): Promise<LayaDecisionResult>;
    /**
     * Read-only report: what answers here, what is loaded, and how the counters look.
     * Never throws for an unreachable launcher; that is a fact the caller wants.
     * @param signal - caller cancellation.
     * @returns the launcher status.
     */
    status(signal?: AbortSignal): Promise<LayaStatusResult>;
    /**
     * Make the launcher ready now, starting a managed process when needed.
     * @param signal - caller cancellation.
     * @returns the ready launcher's report.
     */
    startServer(signal?: AbortSignal): Promise<LayaServerStartResult>;
    /**
     * Stop the launcher this plugin started.
     * @param signal - caller cancellation.
     * @returns whether a process was terminated.
     */
    stopServer(signal?: AbortSignal): Promise<LayaServerStopResult>;
    /** Release the managed process. Never throws. */
    dispose(): Promise<void>;
    /** Ready the launcher according to `mode` and `autoStart`. */
    private prepare;
}
//# sourceMappingURL=service.d.ts.map