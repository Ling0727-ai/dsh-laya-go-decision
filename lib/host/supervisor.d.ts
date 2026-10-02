/**
 * Supervised lifetime for the Laya Go Launcher process.
 *
 * Managed mode owns one child process and its whole process range through
 * `ctx.subprocess`, so plugin unload (or a failed start) leaves no launcher
 * behind on Windows or Linux. The supervisor never spawns blindly: it first asks
 * whether anything already answers at `baseUrl` and adopts a healthy Laya
 * service instead of fighting it for the port, which is what makes several
 * harness sessions share one loaded model.
 *
 * Readiness is a separate step from process start. The launcher binds its
 * listener before the model is loaded, so a 200 from `/api/v1/health` proves the
 * process is up, not that it can predict; the supervisor polls `/api/v1/load`
 * until the phase is `ready`, and reports a `failed` phase with its fallback
 * attempts instead of waiting out the deadline.
 *
 * @module dsh-laya-go-decision/host/supervisor
 */
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess';
import { LayaClient } from './client.ts';
import { normalizeConfig, type NormalizedConfig } from './config.ts';
import type { LayaHealth, LayaLoadState } from './protocol.ts';
/** Minimal logging surface the supervisor needs; `ctx.logger` satisfies it. */
export interface LayaLogger {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
}
/** Lifecycle states reported to the model. */
export type LayaServerState = 'stopped' | 'starting' | 'running' | 'stopping' | 'failed';
/** One observable snapshot of the managed process. */
export interface LayaServerSnapshot {
    readonly state: LayaServerState;
    /** True when this plugin started the process and may stop it. */
    readonly owned: boolean;
    /** True when a launcher that this plugin did not start is being used. */
    readonly adopted: boolean;
    readonly startedAt: string | undefined;
    readonly lastError: string | undefined;
    readonly lastExit: {
        readonly exitCode: number | null;
        readonly signal: string | null;
    } | undefined;
    /** The argv a managed start used or would use. */
    readonly argv: readonly string[];
}
/** Result of making the launcher ready. */
export interface LayaReadyOutcome {
    /** True when this call started the process. */
    readonly started: boolean;
    /** True when an existing launcher was used instead of starting one. */
    readonly adopted: boolean;
    readonly load: LayaLoadState | undefined;
    readonly health: LayaHealth | undefined;
}
/** Result of a stop request. */
export interface LayaStopOutcome {
    /** True when a managed process was actually terminated. */
    readonly stopped: boolean;
    /** True when a process was still running after the grace period. */
    readonly forced: boolean;
}
/** What the supervisor needs from its host plugin. */
export interface LayaServerDeps {
    readonly config: NormalizedConfig;
    readonly client: LayaClient;
    readonly logger: LayaLogger;
    /** Read `ctx.subprocess` lazily: external mode never needs it. */
    readonly getSubprocess: () => SubprocessRuntime | undefined;
}
/** Owns the managed launcher process and its readiness. */
export declare class LayaServerSupervisor {
    private readonly deps;
    private handle;
    private state;
    private adopted;
    private startedAt;
    private lastError;
    private lastExit;
    private startInFlight;
    private stopping;
    private disposed;
    /**
     * @param deps - configuration, client, logger, and lazy subprocess access.
     */
    constructor(deps: LayaServerDeps);
    /** Current lifecycle snapshot. */
    snapshot(): LayaServerSnapshot;
    /**
     * Use an existing launcher, or start one and wait for its model.
     * Concurrent callers share one start attempt.
     * @param signal - caller cancellation.
     * @returns what the launcher reported once it was ready.
     */
    ensureReady(signal?: AbortSignal): Promise<LayaReadyOutcome>;
    /**
     * Require a ready launcher without ever spawning one. Used when
     * `autoStart` is off or the plugin is in `external` mode.
     * @param signal - caller cancellation.
     * @returns the reported load and health.
     * @throws LayaGoError `unreachable`, `not_ready`, or `start_failed`.
     */
    requireReady(signal?: AbortSignal): Promise<LayaReadyOutcome>;
    /**
     * Terminate the process this plugin started. A launcher that this plugin did
     * not start is reported instead of killed.
     * @param signal - caller cancellation.
     * @returns whether a managed process was terminated.
     */
    stop(signal?: AbortSignal): Promise<LayaStopOutcome>;
    /**
     * Terminate any managed process and release state, and refuse every later
     * start. Never throws.
     *
     * A config hot-replace unloads this plugin instance and mounts a fresh one,
     * but a tool call already dispatched (or a stale closure still reachable from
     * the registry) can arrive here afterwards. Marking the runtime disposed is
     * what keeps such a call from spawning a launcher that no live instance would
     * ever own or clean up.
     */
    dispose(): Promise<void>;
    /** Terminate the process this instance started, without poisoning later starts. */
    private shutdown;
    /** Reject any call that could start or adopt a launcher after unload. */
    private assertLive;
    /** Stop the managed process and wait for its whole range to go quiet. */
    private terminate;
    /** Probe, adopt, or start. */
    private reachOrStart;
    /** Resolve the executable, spawn it, and wait for the model. */
    private spawnAndWait;
    /**
     * Poll `/api/v1/load` until the model is ready, failing early when the load
     * failed, the process exited, or the launcher never begins loading.
     */
    private waitForReady;
    /** The polling loop behind {@link waitForReady}. */
    private pollUntilReady;
    /** Build the failure for a launcher that exited before it was ready. */
    private exitError;
    /** Read the retained stderr tail, which is where launcher diagnostics land. */
    private stderrTail;
    /**
     * Record a process exit. Only the handle the supervisor still considers
     * current may move the state, so an exit that arrives after an intentional
     * stop or a restart cannot overwrite the newer state.
     */
    private onExit;
    /** Clear all process state. */
    private reset;
}
/**
 * Build one normalized configuration and its client and supervisor.
 * @param rawConfig - loader-validated configuration.
 * @param logger - plugin logger.
 * @param getSubprocess - lazy `ctx.subprocess` accessor.
 * @returns the normalized config, client, and supervisor.
 */
export declare function createServerRuntime(rawConfig: Parameters<typeof normalizeConfig>[0], logger: LayaLogger, getSubprocess: () => SubprocessRuntime | undefined): {
    config: NormalizedConfig;
    client: LayaClient;
    supervisor: LayaServerSupervisor;
};
//# sourceMappingURL=supervisor.d.ts.map