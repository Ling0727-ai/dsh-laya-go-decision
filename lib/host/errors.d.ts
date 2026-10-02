/**
 * Failure vocabulary for the Laya Go Launcher decision plugin.
 *
 * Every failure the plugin can produce carries a stable machine-readable
 * {@link LayaGoError.code} plus an optional actionable `hint`. Infrastructure
 * failures are thrown (the tool registry turns them into `isError` results with
 * the message preserved); domain outcomes such as "the server is unreachable
 * right now" are returned as canonical values instead, so a caller can act on
 * them without parsing prose.
 *
 * @module dsh-laya-go-decision/host/errors
 */
/** Stable failure codes this plugin reports. */
export type LayaGoErrorCode = 
/** The configured base URL or another config value cannot be used. */
'invalid_config'
/** Question definitions are missing, duplicated, or unusable for Laya. */
 | 'invalid_questions'
/** The state payload is larger than the configured allowance. */
 | 'state_too_large'
/** Nothing answers at the configured base URL. */
 | 'unreachable'
/** A request exceeded its configured timeout. */
 | 'timeout'
/** The caller aborted the request. */
 | 'aborted'
/** The server answers but has no model ready. */
 | 'not_ready'
/** No `ctx.subprocess` provider is mounted, so managed mode cannot start a process. */
 | 'subprocess_missing'
/** The configured executable could not be resolved. */
 | 'executable_missing'
/** The managed server process exited before it became ready. */
 | 'server_exited'
/** Starting the managed server failed. */
 | 'start_failed'
/** The managed server did not become ready inside `startTimeoutMs`. */
 | 'start_timeout'
/** A stop/restart was requested for a server this plugin does not own. */
 | 'server_not_managed'
/** The plugin instance was unloaded, so it refuses to start or adopt a launcher. */
 | 'runtime_disposed'
/** The Laya HTTP API answered with an error status. */
 | 'http_error'
/** The Laya engine is not loaded. */
 | 'engine_not_loaded'
/** The Laya API rejected the request body. */
 | 'invalid_request'
/** The forward pass failed inside Laya. */
 | 'inference_failed'
/** The HTTP response did not match the documented contract. */
 | 'bad_response'
/** The local concurrency cap is saturated and the caller chose not to wait. */
 | 'busy';
/** Optional context carried by a {@link LayaGoError}. */
export interface LayaGoErrorOptions {
    /** One actionable sentence appended to the message. */
    readonly hint?: string;
    /** HTTP status, when the failure came from the Laya API. */
    readonly status?: number;
    /** Raw server detail (for example the Laya error `code`). */
    readonly detail?: string;
    /** Original failure, when this error wraps one. */
    readonly cause?: unknown;
}
/**
 * One plugin failure with a stable code.
 *
 * `message` stays human-readable; `code` is what a caller or a test asserts on.
 * The optional `hint` is appended to the message as well as kept as its own
 * field: DSH renders only `error.message` for a thrown tool failure, and the
 * recovery step is the part the model actually needs to read.
 */
export declare class LayaGoError extends Error {
    /** Stable machine-readable failure code. */
    readonly code: LayaGoErrorCode;
    /** Actionable follow-up, when the plugin can name one. */
    readonly hint: string | undefined;
    /** HTTP status from the Laya API, when applicable. */
    readonly status: number | undefined;
    /** Raw server-side detail (a Laya error code, a launcher attempt error). */
    readonly detail: string | undefined;
    /**
     * @param code - stable failure code.
     * @param message - human-readable summary.
     * @param options - optional hint, HTTP status, server detail, and cause.
     */
    constructor(code: LayaGoErrorCode, message: string, options?: LayaGoErrorOptions);
    /** The message a model or a log line should read, including the hint. */
    describe(): string;
}
/**
 * Whether the caller's own signal caused the failure. The plugin always
 * distinguishes this from its configured deadline, because the two want
 * different reports (`aborted` versus `timeout`).
 * @param signal - the caller-owned signal, when one was supplied.
 * @returns whether the caller aborted.
 */
export declare function callerAborted(signal: AbortSignal | undefined): boolean;
/**
 * Whether a caught value is the abort-shaped error `AbortSignal.timeout()` or
 * an aborted fetch produces. Node reports the timeout as `TimeoutError` and an
 * explicit abort as `AbortError`.
 * @param error - value caught from an aborted operation.
 * @returns whether the failure came from a deadline or abort.
 */
export declare function isDeadlineError(error: unknown): boolean;
//# sourceMappingURL=errors.d.ts.map