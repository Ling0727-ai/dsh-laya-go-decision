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
import { type LayaHealth, type LayaLoadState, type LayaMetrics, type LayaPredictRequest, type LayaPredictResponse } from './protocol.ts';
/** Construction options for {@link LayaClient}. */
export interface LayaClientOptions {
    /** API origin including the `/api/v1` suffix. */
    readonly apiBaseUrl: string;
    /** Default per-request timeout. */
    readonly requestTimeoutMs: number;
    /** Short timeout used by {@link LayaClient.probe}. */
    readonly probeTimeoutMs: number;
    /** Bearer token for admin endpoints, when the launcher requires one. */
    readonly adminToken?: string | undefined;
    /** Injected `fetch` implementation, for tests. */
    readonly fetchImpl?: typeof fetch | undefined;
}
/** Per-call overrides. */
export interface LayaRequestOptions {
    /** Caller-owned cancellation; its abort is reported as `aborted`. */
    readonly signal?: AbortSignal | undefined;
    /** Override the client's default timeout for this call. */
    readonly timeoutMs?: number | undefined;
    /** Send the admin bearer token, when one is configured. */
    readonly admin?: boolean | undefined;
}
/** What the plugin found when it asked whether a Laya service is there. */
export type LayaProbe = 
/** A Laya launcher answered `/api/v1/health`. */
{
    readonly kind: 'laya';
    readonly health: LayaHealth;
}
/** Nothing answered: the port is closed, or no response arrived in time. */
 | {
    readonly kind: 'absent';
    readonly reason: string;
}
/** Something answered, but not with a Laya health payload. */
 | {
    readonly kind: 'foreign';
    readonly reason: string;
};
/** Client for one Laya launcher origin. */
export declare class LayaClient {
    /** API origin, including `/api/v1`. */
    readonly apiBaseUrl: string;
    private readonly requestTimeoutMs;
    private readonly probeTimeoutMs;
    private readonly adminToken;
    private readonly fetchImpl;
    /**
     * @param options - origin, timeouts, optional admin token, optional fetch.
     */
    constructor(options: LayaClientOptions);
    /** `GET /api/v1/health`. */
    health(options?: LayaRequestOptions): Promise<LayaHealth>;
    /** `GET /api/v1/load`: the most recent load and every fallback attempt. */
    loadState(options?: LayaRequestOptions): Promise<LayaLoadState>;
    /** `GET /api/v1/metrics`. */
    metrics(options?: LayaRequestOptions): Promise<LayaMetrics>;
    /** `GET /api/v1/config`. */
    serverConfig(options?: LayaRequestOptions): Promise<unknown>;
    /** `POST /api/v1/predict`. */
    predict(request: LayaPredictRequest, options?: LayaRequestOptions): Promise<LayaPredictResponse>;
    /**
     * Ask whether a Laya service answers here, without deciding anything.
     * @param signal - caller cancellation.
     * @returns a classified probe result; never throws.
     */
    probe(signal?: AbortSignal): Promise<LayaProbe>;
    /** Send one request and return the decoded JSON body. */
    private send;
    /** Decode a JSON body, tolerating an empty body but not malformed JSON. */
    private decode;
    /** Turn a transport failure into the right plugin error. */
    private translate;
    /** Map a non-2xx response onto a plugin error, keeping the Laya code. */
    private mapHttpError;
}
//# sourceMappingURL=client.d.ts.map