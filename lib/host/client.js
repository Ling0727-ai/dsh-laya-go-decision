/**
 * HTTP client for the Laya Go Launcher API.
 *
 * One client owns the origin, the per-request timeout, and the optional admin
 * token. Every failure is translated into a {@link LayaGoError} with a stable
 * code, so callers never inspect `fetch` internals: `aborted` and `timeout` stay
 * distinct, "nothing is listening" is `unreachable`, and a Laya error body keeps
 * its own code, status, and message.
 *
 * @module dsh-laya-go-decision/host/client
 */
import { LayaGoError, callerAborted, isDeadlineError } from "./errors.js";
import { parseErrorEnvelope, parseHealth, parseLoadState, parseMetrics, parsePredictResponse, } from "./protocol.js";
/** Laya error codes with a plugin-specific recovery hint. */
const ERROR_HINTS = {
    engine_not_loaded: 'Load a model first: use laya_go_server with action "start", or POST /api/v1/load/auto.',
    runtime_missing: 'The kernel runtime is missing; install it or point the launcher\'s onnx_runtime_path at it.',
    engine_incompatible: 'The plan was built for another TensorRT version or GPU; rebuild it with the launcher\'s convert endpoint.',
    engine_wrong_kernel: 'That file belongs to the other kernel; load a file matching the selected backend.',
    invalid_request: 'Check the question definitions: choice needs a non-empty criteria map, score needs at least two levels, noul needs a yes/no instruction.',
    payload_too_large: 'Shorten the state; the launcher rejects request bodies over 1 MiB.',
    manager_closed: 'The launcher closed its backend; restart the server.',
};
/** Map a Laya error code onto this plugin's vocabulary. */
const ERROR_CODES = {
    engine_not_loaded: 'engine_not_loaded',
    invalid_request: 'invalid_request',
    inference_failed: 'inference_failed',
    payload_too_large: 'invalid_request',
    engine_not_found: 'not_ready',
    engine_wrong_kernel: 'not_ready',
    engine_incompatible: 'not_ready',
    runtime_missing: 'not_ready',
    manager_closed: 'not_ready',
};
/** Client for one Laya launcher origin. */
export class LayaClient {
    /** API origin, including `/api/v1`. */
    apiBaseUrl;
    requestTimeoutMs;
    probeTimeoutMs;
    adminToken;
    fetchImpl;
    /**
     * @param options - origin, timeouts, optional admin token, optional fetch.
     */
    constructor(options) {
        this.apiBaseUrl = options.apiBaseUrl.replace(/\/+$/, '');
        this.requestTimeoutMs = options.requestTimeoutMs;
        this.probeTimeoutMs = options.probeTimeoutMs;
        this.adminToken = options.adminToken;
        this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    }
    /** `GET /api/v1/health`. */
    async health(options = {}) {
        return parseHealth(await this.send('GET', '/health', undefined, options));
    }
    /** `GET /api/v1/load`: the most recent load and every fallback attempt. */
    async loadState(options = {}) {
        return parseLoadState(await this.send('GET', '/load', undefined, options));
    }
    /** `GET /api/v1/metrics`. */
    async metrics(options = {}) {
        return parseMetrics(await this.send('GET', '/metrics', undefined, options));
    }
    /** `GET /api/v1/config`. */
    async serverConfig(options = {}) {
        return this.send('GET', '/config', undefined, options);
    }
    /** `POST /api/v1/predict`. */
    async predict(request, options = {}) {
        return parsePredictResponse(await this.send('POST', '/predict', request, options));
    }
    /**
     * Ask whether a Laya service answers here, without deciding anything.
     * @param signal - caller cancellation.
     * @returns a classified probe result; never throws.
     */
    async probe(signal) {
        try {
            const health = await this.health({ signal, timeoutMs: this.probeTimeoutMs });
            return { kind: 'laya', health };
        }
        catch (error) {
            if (error instanceof LayaGoError && error.code === 'bad_response') {
                return { kind: 'foreign', reason: error.message };
            }
            if (error instanceof LayaGoError && error.code === 'aborted') {
                return { kind: 'absent', reason: 'the probe was aborted' };
            }
            return { kind: 'absent', reason: error instanceof Error ? error.message : String(error) };
        }
    }
    /** Send one request and return the decoded JSON body. */
    async send(method, path, body, options) {
        const timeoutMs = options.timeoutMs ?? this.requestTimeoutMs;
        const timeout = AbortSignal.timeout(timeoutMs);
        const signal = options.signal === undefined ? timeout : AbortSignal.any([timeout, options.signal]);
        const headers = { accept: 'application/json' };
        if (body !== undefined)
            headers['content-type'] = 'application/json';
        if (options.admin === true && this.adminToken !== undefined)
            headers['authorization'] = `Bearer ${this.adminToken}`;
        const what = `${method} ${path}`;
        let response;
        try {
            response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
                method,
                headers,
                ...body === undefined ? {} : { body: JSON.stringify(body) },
                signal,
            });
        }
        catch (cause) {
            throw this.translate(cause, what, options.signal, timeoutMs);
        }
        let text;
        try {
            text = await response.text();
        }
        catch (cause) {
            throw this.translate(cause, what, options.signal, timeoutMs);
        }
        const decoded = this.decode(text, what);
        if (!response.ok)
            throw this.mapHttpError(response.status, what, decoded);
        return decoded;
    }
    /** Decode a JSON body, tolerating an empty body but not malformed JSON. */
    decode(text, what) {
        if (text.trim() === '')
            return undefined;
        try {
            return JSON.parse(text);
        }
        catch (cause) {
            throw new LayaGoError('bad_response', `${what} returned a body that is not JSON`, {
                hint: 'Check that baseUrl points at the Laya launcher and not at another service on that port.',
                cause,
            });
        }
    }
    /** Turn a transport failure into the right plugin error. */
    translate(cause, what, signal, timeoutMs) {
        if (callerAborted(signal)) {
            return new LayaGoError('aborted', `${what} was aborted by the caller`, { cause });
        }
        if (isDeadlineError(cause)) {
            return new LayaGoError('timeout', `${what} did not finish within ${timeoutMs} ms`, {
                hint: 'Raise requestTimeoutMs, or check whether the launcher is still loading a model.',
                cause,
            });
        }
        return new LayaGoError('unreachable', `no Laya service answered at ${this.apiBaseUrl}`, {
            hint: 'Start the launcher (laya_go_server action "start"), or point baseUrl at a running server.',
            cause,
        });
    }
    /** Map a non-2xx response onto a plugin error, keeping the Laya code. */
    mapHttpError(status, what, body) {
        const { code, message } = parseErrorEnvelope(body);
        const mapped = (code === undefined ? undefined : ERROR_CODES[code]) ?? 'http_error';
        const hint = code === undefined ? undefined : ERROR_HINTS[code];
        return new LayaGoError(mapped, `${what} failed with HTTP ${status}${message === undefined ? '' : `: ${message}`}`, {
            ...hint === undefined ? {} : { hint },
            status,
            ...code === undefined ? {} : { detail: code },
        });
    }
}
//# sourceMappingURL=client.js.map