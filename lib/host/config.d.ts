/**
 * Deployment configuration for the Laya Go Launcher decision plugin.
 *
 * Every value a deployment could reasonably need differently is a field here
 * with a schema default, so nothing behavioural is baked into the code. The
 * two mode-specific groups are the launcher flags (`executable`, `args`,
 * `serverCwd`, `env`) and the interaction budgets (`startTimeoutMs`,
 * `requestTimeoutMs`, `maxConcurrent`, ...).
 *
 * @module dsh-laya-go-decision/host/config
 */
import type { Volatile } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
/** `managed` starts the launcher process; `external` only talks to one already running. */
export type LayaGoMode = 'managed' | 'external';
/** Plugin configuration as written in `cordis.patch.yml`. */
export interface Config {
    /** `managed` starts and stops the launcher; `external` never spawns anything. */
    mode: LayaGoMode;
    /** Origin (and optional path prefix) of the Laya HTTP API, for example `http://127.0.0.1:8420`. */
    baseUrl: Volatile<string>;
    /** Launcher executable: an absolute path, or a bare name resolved against `PATH`. */
    executable: Volatile<string>;
    /** Launcher flags; `--addr` is derived from `baseUrl` unless present here. */
    args: string[];
    /** Working directory for the launcher process. Defaults to the harness process directory. */
    serverCwd?: Volatile<string | undefined>;
    /** Extra environment entries for the launcher process (merged after the harness's scrub). */
    env?: Record<string, string>;
    /** Start the launcher on the first call that needs a model. */
    autoStart: boolean;
    /** How long a managed start may take before it is reported as `start_timeout`. */
    startTimeoutMs: number;
    /** How long a listening launcher may stay in `idle` before the start reports what it found. */
    loadIdleGraceMs: number;
    /** Poll interval while waiting for the model to become ready. */
    readyPollMs: number;
    /** Per-request timeout for Laya API calls. */
    requestTimeoutMs: number;
    /** Grace period handed to the subprocess provider when terminating the launcher. */
    shutdownGraceMs: number;
    /** Maximum Laya prediction requests in flight; further callers wait their turn. */
    maxConcurrent: number;
    /** Maximum questions in one decision; a forward pass shares one head budget. */
    maxQuestions: number;
    /** Maximum characters of `state` accepted by one decision. */
    maxStateChars: number;
    /** Answers at or above this confidence are reported as certain. */
    confidenceThreshold: number;
    /** Bearer token for the launcher's admin endpoints, when one is configured. */
    adminToken?: string;
    /** Bytes of launcher stdout/stderr retained for diagnostics. */
    logBytes: number;
}
/** Loader schema: validates config at plugin load and fills every default. */
export declare const Config: Schema<Config>;
/** Configuration after validation and normalization: every derived value resolved. */
export interface NormalizedConfig {
    readonly mode: LayaGoMode;
    /** API origin with trailing slashes and a trailing `/api/v1` removed. */
    readonly baseUrl: string;
    /** `baseUrl` plus `/api/v1`. */
    readonly apiBaseUrl: string;
    /** `host:port` pair for the launcher's `--addr` flag. */
    readonly endpoint: string;
    readonly executable: string;
    readonly args: readonly string[];
    readonly serverCwd: string | undefined;
    readonly env: Readonly<Record<string, string>> | undefined;
    readonly autoStart: boolean;
    readonly startTimeoutMs: number;
    readonly loadIdleGraceMs: number;
    readonly readyPollMs: number;
    readonly requestTimeoutMs: number;
    readonly shutdownGraceMs: number;
    readonly maxConcurrent: number;
    readonly maxQuestions: number;
    readonly maxStateChars: number;
    readonly confidenceThreshold: number;
    readonly adminToken: string | undefined;
    readonly logBytes: number;
    /** Short timeout for the "is anything there?" probe. */
    readonly probeTimeoutMs: number;
}
export declare function normalizeConfig(config: Config): NormalizedConfig;
/**
 * Build the launcher argv tail, keeping `baseUrl` the single source of truth for
 * the listen address unless the deployment spelled `--addr` itself.
 * @param config - normalized configuration.
 * @returns the flags to append after the executable.
 */
export declare function serverArgs(config: NormalizedConfig): string[];
//# sourceMappingURL=config.d.ts.map