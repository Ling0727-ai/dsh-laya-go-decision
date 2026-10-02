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
/** One decoded JSON object. */
export type JsonObject = Record<string, unknown>;
/** Launcher load phase as reported by `GET /api/v1/load`. */
export type LayaLoadPhase = 'idle' | 'loading' | 'ready' | 'failed';
/** One fallback-chain step, as it actually happened. */
export interface LayaLoadAttempt {
    readonly model?: string | undefined;
    readonly backend?: string | undefined;
    readonly provider?: string | undefined;
    readonly path?: string | undefined;
    readonly ok?: boolean | undefined;
    readonly skipped?: boolean | undefined;
    readonly error?: string | undefined;
    readonly ms?: number | undefined;
}
/** The most recent load: its phase, chosen model, and every attempt. */
export interface LayaLoadState {
    readonly phase: LayaLoadPhase;
    readonly mode?: string | undefined;
    readonly step?: string | undefined;
    readonly path?: string | undefined;
    readonly backend?: string | undefined;
    readonly device?: string | undefined;
    readonly note?: string | undefined;
    readonly error?: string | undefined;
    readonly attempts: readonly LayaLoadAttempt[];
}
/** Which kernel is available, and which one a load would use right now. */
export interface LayaBackendInfo {
    readonly requested?: string | undefined;
    readonly selected?: string | undefined;
    readonly note?: string | undefined;
    readonly onnx?: {
        readonly available?: boolean | undefined;
        readonly version?: string | undefined;
        readonly error?: string | undefined;
    } | undefined;
}
/** GPU facts reported by the launcher. */
export interface LayaDeviceInfo {
    readonly name?: string | undefined;
    readonly computeCapability?: string | undefined;
    readonly vramFreeMb?: number | undefined;
    readonly vramTotalMb?: number | undefined;
}
/** The loaded engine's identity. */
export interface LayaEngineInfo {
    readonly loaded: boolean;
    readonly path?: string | undefined;
    readonly backend?: string | undefined;
    readonly contexts?: number | undefined;
}
/** `GET /api/v1/health`. */
export interface LayaHealth {
    readonly status?: string | undefined;
    readonly version?: string | undefined;
    readonly backend?: LayaBackendInfo | undefined;
    readonly device?: LayaDeviceInfo | undefined;
    readonly engine?: LayaEngineInfo | undefined;
}
/** Laya question kinds. */
export type LayaQuestionType = 'choice' | 'score' | 'noul';
/** One question in the shape `POST /api/v1/predict` expects. */
export interface LayaQuestionSpec {
    readonly type: LayaQuestionType;
    readonly instructions: string;
    /** `choice`: label to description; `score`: level descriptions low to high; `noul`: omitted. */
    readonly criteria?: Readonly<Record<string, string>> | readonly string[] | undefined;
}
/** Request body of `POST /api/v1/predict`. */
export interface LayaPredictRequest {
    readonly state: string | JsonObject | readonly unknown[];
    readonly questions: Readonly<Record<string, LayaQuestionSpec>>;
}
/** The decision head's auxiliary action logits. */
export interface LayaAction {
    readonly actProbability?: number | undefined;
}
/** One answered question. */
export interface LayaAnswer {
    readonly type: string;
    readonly confidence: number;
    readonly choice?: string | undefined;
    readonly probabilities?: Readonly<Record<string, number>> | undefined;
    readonly action?: LayaAction | undefined;
    readonly score?: number | undefined;
    readonly legend?: Readonly<Record<string, string>> | undefined;
    readonly noul?: number | undefined;
}
/** Token accounting for one prediction. */
export interface LayaUsage {
    readonly inputTokens?: number | undefined;
    readonly outputTokens?: number | undefined;
}
/** Latency breakdown for one prediction. */
export interface LayaTiming {
    readonly totalMs?: number | undefined;
    readonly tokenizeMs?: number | undefined;
    readonly inferenceMs?: number | undefined;
}
/** Response body of `POST /api/v1/predict`. */
export interface LayaPredictResponse {
    readonly model?: string | undefined;
    readonly answers: Readonly<Record<string, LayaAnswer>>;
    readonly usage?: LayaUsage | undefined;
    readonly timing?: LayaTiming | undefined;
}
/** `GET /api/v1/metrics`. */
export interface LayaMetrics {
    readonly requestsTotal?: number | undefined;
    readonly requestsFailed?: number | undefined;
    readonly predictTotal?: number | undefined;
    readonly latency?: {
        readonly p50?: number | undefined;
        readonly p90?: number | undefined;
        readonly p99?: number | undefined;
        readonly min?: number | undefined;
        readonly max?: number | undefined;
    } | undefined;
}
/** The Laya error envelope: `{ "error": { "code", "message" } }`. */
export interface LayaErrorEnvelope {
    readonly code?: string | undefined;
    readonly message?: string | undefined;
}
/**
 * Narrow a decoded body to an object.
 * @param value - decoded JSON.
 * @returns the object, or undefined for anything else.
 */
export declare function asObject(value: unknown): JsonObject | undefined;
/**
 * Read the Laya error envelope out of an error response body.
 * @param value - decoded JSON body.
 * @returns the code and message, when the body carries them.
 */
export declare function parseErrorEnvelope(value: unknown): LayaErrorEnvelope;
/**
 * Parse `GET /api/v1/health`.
 * @param value - decoded JSON body.
 * @returns the health payload, with absent sections omitted.
 */
export declare function parseHealth(value: unknown): LayaHealth;
/**
 * Parse `GET /api/v1/load`.
 * @param value - decoded JSON body.
 * @returns the load state with its attempt list.
 */
export declare function parseLoadState(value: unknown): LayaLoadState;
/**
 * Parse `POST /api/v1/predict`.
 * @param value - decoded JSON body.
 * @returns the answers plus usage and timing.
 * @throws LayaGoError `bad_response` when no answers are present.
 */
export declare function parsePredictResponse(value: unknown): LayaPredictResponse;
/**
 * Parse `GET /api/v1/metrics`.
 * @param value - decoded JSON body.
 * @returns the counters and latency percentiles the plugin reports.
 */
export declare function parseMetrics(value: unknown): LayaMetrics;
//# sourceMappingURL=protocol.d.ts.map