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
/**
 * One plugin failure with a stable code.
 *
 * `message` stays human-readable; `code` is what a caller or a test asserts on.
 * The optional `hint` is appended to the message as well as kept as its own
 * field: DSH renders only `error.message` for a thrown tool failure, and the
 * recovery step is the part the model actually needs to read.
 */
export class LayaGoError extends Error {
    /** Stable machine-readable failure code. */
    code;
    /** Actionable follow-up, when the plugin can name one. */
    hint;
    /** HTTP status from the Laya API, when applicable. */
    status;
    /** Raw server-side detail (a Laya error code, a launcher attempt error). */
    detail;
    /**
     * @param code - stable failure code.
     * @param message - human-readable summary.
     * @param options - optional hint, HTTP status, server detail, and cause.
     */
    constructor(code, message, options = {}) {
        super(options.hint === undefined ? message : `${message} — ${options.hint}`, options.cause === undefined ? undefined : { cause: options.cause });
        this.name = 'LayaGoError';
        this.code = code;
        this.hint = options.hint;
        this.status = options.status;
        this.detail = options.detail;
    }
    /** The message a model or a log line should read, including the hint. */
    describe() {
        return this.message;
    }
}
/**
 * Whether the caller's own signal caused the failure. The plugin always
 * distinguishes this from its configured deadline, because the two want
 * different reports (`aborted` versus `timeout`).
 * @param signal - the caller-owned signal, when one was supplied.
 * @returns whether the caller aborted.
 */
export function callerAborted(signal) {
    return signal?.aborted === true;
}
/**
 * Whether a caught value is the abort-shaped error `AbortSignal.timeout()` or
 * an aborted fetch produces. Node reports the timeout as `TimeoutError` and an
 * explicit abort as `AbortError`.
 * @param error - value caught from an aborted operation.
 * @returns whether the failure came from a deadline or abort.
 */
export function isDeadlineError(error) {
    return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}
//# sourceMappingURL=errors.js.map