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

import { LayaGoError, callerAborted, isDeadlineError, type LayaGoErrorCode } from './errors.ts'
import {
  parseErrorEnvelope,
  parseHealth,
  parseLoadState,
  parseMetrics,
  parsePredictResponse,
  type LayaHealth,
  type LayaLoadState,
  type LayaMetrics,
  type LayaPredictRequest,
  type LayaPredictResponse,
} from './protocol.ts'

/** Construction options for {@link LayaClient}. */
export interface LayaClientOptions {
  /** API origin including the `/api/v1` suffix. */
  readonly apiBaseUrl: string
  /** Default per-request timeout. */
  readonly requestTimeoutMs: number
  /** Short timeout used by {@link LayaClient.probe}. */
  readonly probeTimeoutMs: number
  /** Bearer token for admin endpoints, when the launcher requires one. */
  readonly adminToken?: string | undefined
  /** Injected `fetch` implementation, for tests. */
  readonly fetchImpl?: typeof fetch | undefined
}

/** Per-call overrides. */
export interface LayaRequestOptions {
  /** Caller-owned cancellation; its abort is reported as `aborted`. */
  readonly signal?: AbortSignal | undefined
  /** Override the client's default timeout for this call. */
  readonly timeoutMs?: number | undefined
  /** Send the admin bearer token, when one is configured. */
  readonly admin?: boolean | undefined
}

/** What the plugin found when it asked whether a Laya service is there. */
export type LayaProbe =
  /** A Laya launcher answered `/api/v1/health`. */
  | { readonly kind: 'laya'; readonly health: LayaHealth }
  /** Nothing answered: the port is closed, or no response arrived in time. */
  | { readonly kind: 'absent'; readonly reason: string }
  /** Something answered, but not with a Laya health payload. */
  | { readonly kind: 'foreign'; readonly reason: string }

/** Laya error codes with a plugin-specific recovery hint. */
const ERROR_HINTS: Readonly<Partial<Record<string, string>>> = {
  engine_not_loaded: 'Load a model first: use laya_go_server with action "start", or POST /api/v1/load/auto.',
  runtime_missing: 'The kernel runtime is missing; install it or point the launcher\'s onnx_runtime_path at it.',
  engine_incompatible: 'The plan was built for another TensorRT version or GPU; rebuild it with the launcher\'s convert endpoint.',
  engine_wrong_kernel: 'That file belongs to the other kernel; load a file matching the selected backend.',
  invalid_request: 'Check the question definitions: choice needs a non-empty criteria map, score needs at least two levels, noul needs a yes/no instruction.',
  payload_too_large: 'Shorten the state; the launcher rejects request bodies over 1 MiB.',
  manager_closed: 'The launcher closed its backend; restart the server.',
}

/** Map a Laya error code onto this plugin's vocabulary. */
const ERROR_CODES: Readonly<Partial<Record<string, LayaGoErrorCode>>> = {
  engine_not_loaded: 'engine_not_loaded',
  invalid_request: 'invalid_request',
  inference_failed: 'inference_failed',
  payload_too_large: 'invalid_request',
  engine_not_found: 'not_ready',
  engine_wrong_kernel: 'not_ready',
  engine_incompatible: 'not_ready',
  runtime_missing: 'not_ready',
  manager_closed: 'not_ready',
}

/** Client for one Laya launcher origin. */
export class LayaClient {
  /** API origin, including `/api/v1`. */
  readonly apiBaseUrl: string
  private readonly requestTimeoutMs: number
  private readonly probeTimeoutMs: number
  private readonly adminToken: string | undefined
  private readonly fetchImpl: typeof fetch

  /**
   * @param options - origin, timeouts, optional admin token, optional fetch.
   */
  constructor(options: LayaClientOptions) {
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/+$/, '')
    this.requestTimeoutMs = options.requestTimeoutMs
    this.probeTimeoutMs = options.probeTimeoutMs
    this.adminToken = options.adminToken
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
  }

  /** `GET /api/v1/health`. */
  async health(options: LayaRequestOptions = {}): Promise<LayaHealth> {
    return parseHealth(await this.send('GET', '/health', undefined, options))
  }

  /** `GET /api/v1/load`: the most recent load and every fallback attempt. */
  async loadState(options: LayaRequestOptions = {}): Promise<LayaLoadState> {
    return parseLoadState(await this.send('GET', '/load', undefined, options))
  }

  /** `GET /api/v1/metrics`. */
  async metrics(options: LayaRequestOptions = {}): Promise<LayaMetrics> {
    return parseMetrics(await this.send('GET', '/metrics', undefined, options))
  }

  /** `GET /api/v1/config`. */
  async serverConfig(options: LayaRequestOptions = {}): Promise<unknown> {
    return this.send('GET', '/config', undefined, options)
  }

  /** `POST /api/v1/predict`. */
  async predict(request: LayaPredictRequest, options: LayaRequestOptions = {}): Promise<LayaPredictResponse> {
    return parsePredictResponse(await this.send('POST', '/predict', request, options))
  }

  /**
   * Ask whether a Laya service answers here, without deciding anything.
   * @param signal - caller cancellation.
   * @returns a classified probe result; never throws.
   */
  async probe(signal?: AbortSignal): Promise<LayaProbe> {
    try {
      const health = await this.health({ signal, timeoutMs: this.probeTimeoutMs })
      return { kind: 'laya', health }
    } catch (error) {
      if (error instanceof LayaGoError && error.code === 'bad_response') {
        return { kind: 'foreign', reason: error.message }
      }
      if (error instanceof LayaGoError && error.code === 'aborted') {
        return { kind: 'absent', reason: 'the probe was aborted' }
      }
      return { kind: 'absent', reason: error instanceof Error ? error.message : String(error) }
    }
  }

  /** Send one request and return the decoded JSON body. */
  private async send(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body: unknown,
    options: LayaRequestOptions,
  ): Promise<unknown> {
    const timeoutMs = options.timeoutMs ?? this.requestTimeoutMs
    const timeout = AbortSignal.timeout(timeoutMs)
    const signal = options.signal === undefined ? timeout : AbortSignal.any([timeout, options.signal])
    const headers: Record<string, string> = { accept: 'application/json' }
    if (body !== undefined) headers['content-type'] = 'application/json'
    if (options.admin === true && this.adminToken !== undefined) headers['authorization'] = `Bearer ${this.adminToken}`
    const what = `${method} ${path}`

    let response: Response
    try {
      response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
        method,
        headers,
        ...body === undefined ? {} : { body: JSON.stringify(body) },
        signal,
      })
    } catch (cause) {
      throw this.translate(cause, what, options.signal, timeoutMs)
    }

    let text: string
    try {
      text = await response.text()
    } catch (cause) {
      throw this.translate(cause, what, options.signal, timeoutMs)
    }

    const decoded = this.decode(text, what)
    if (!response.ok) throw this.mapHttpError(response.status, what, decoded)
    return decoded
  }

  /** Decode a JSON body, tolerating an empty body but not malformed JSON. */
  private decode(text: string, what: string): unknown {
    if (text.trim() === '') return undefined
    try {
      return JSON.parse(text)
    } catch (cause) {
      throw new LayaGoError('bad_response', `${what} returned a body that is not JSON`, {
        hint: 'Check that baseUrl points at the Laya launcher and not at another service on that port.',
        cause,
      })
    }
  }

  /** Turn a transport failure into the right plugin error. */
  private translate(cause: unknown, what: string, signal: AbortSignal | undefined, timeoutMs: number): LayaGoError {
    if (callerAborted(signal)) {
      return new LayaGoError('aborted', `${what} was aborted by the caller`, { cause })
    }
    if (isDeadlineError(cause)) {
      return new LayaGoError('timeout', `${what} did not finish within ${timeoutMs} ms`, {
        hint: 'Raise requestTimeoutMs, or check whether the launcher is still loading a model.',
        cause,
      })
    }
    return new LayaGoError('unreachable', `no Laya service answered at ${this.apiBaseUrl}`, {
      hint: 'Start the launcher (laya_go_server action "start"), or point baseUrl at a running server.',
      cause,
    })
  }

  /** Map a non-2xx response onto a plugin error, keeping the Laya code. */
  private mapHttpError(status: number, what: string, body: unknown): LayaGoError {
    const { code, message } = parseErrorEnvelope(body)
    const mapped = (code === undefined ? undefined : ERROR_CODES[code]) ?? 'http_error'
    const hint = code === undefined ? undefined : ERROR_HINTS[code]
    return new LayaGoError(mapped, `${what} failed with HTTP ${status}${message === undefined ? '' : `: ${message}`}`, {
      ...hint === undefined ? {} : { hint },
      status,
      ...code === undefined ? {} : { detail: code },
    })
  }
}
