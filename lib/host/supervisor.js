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
import { LayaClient } from "./client.js";
import { normalizeConfig, serverArgs } from "./config.js";
import { LayaGoError, callerAborted } from "./errors.js";
/**
 * Sleep that reports caller abort instead of resolving late.
 * @param ms - milliseconds to wait.
 * @param signal - cancellation.
 * @returns a promise that settles after `ms` or on abort.
 */
function delay(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(new LayaGoError('aborted', 'the wait was aborted'));
            return;
        }
        const onAbort = () => {
            clearTimeout(timer);
            reject(new LayaGoError('aborted', 'the wait was aborted'));
        };
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        signal.addEventListener('abort', onAbort, { once: true });
    });
}
/** One-line summary of a failed load's fallback attempts. */
function attemptsSummary(load) {
    const failed = load.attempts.filter(attempt => attempt.skipped !== true && attempt.ok !== true);
    if (failed.length === 0)
        return undefined;
    const parts = failed.map(attempt => {
        const name = attempt.backend ?? attempt.provider ?? attempt.model ?? attempt.path ?? 'attempt';
        return `${name}: ${attempt.error ?? 'no error reported'}`;
    });
    return `Fallback attempts — ${parts.join('; ')}`;
}
/** Wrap an unknown failure as a plugin error. */
function asLayaError(error, message) {
    if (error instanceof LayaGoError)
        return error;
    return new LayaGoError('start_failed', message, { cause: error });
}
/** Owns the managed launcher process and its readiness. */
export class LayaServerSupervisor {
    deps;
    handle;
    state = 'stopped';
    adopted = false;
    startedAt;
    lastError;
    lastExit;
    startInFlight;
    stopping = false;
    disposed = false;
    /**
     * @param deps - configuration, client, logger, and lazy subprocess access.
     */
    constructor(deps) {
        this.deps = deps;
    }
    /** Current lifecycle snapshot. */
    snapshot() {
        const config = this.deps.config;
        return {
            state: this.state,
            owned: this.handle !== undefined && !this.adopted,
            adopted: this.adopted,
            startedAt: this.startedAt,
            lastError: this.lastError,
            lastExit: this.lastExit === undefined
                ? undefined
                : { exitCode: this.lastExit.exitCode, signal: this.lastExit.signal },
            argv: [config.executable, ...serverArgs(config)],
        };
    }
    /**
     * Use an existing launcher, or start one and wait for its model.
     * Concurrent callers share one start attempt.
     * @param signal - caller cancellation.
     * @returns what the launcher reported once it was ready.
     */
    async ensureReady(signal) {
        this.assertLive();
        if (this.startInFlight !== undefined)
            return this.startInFlight;
        const attempt = this.reachOrStart(signal);
        this.startInFlight = attempt;
        try {
            return await attempt;
        }
        finally {
            this.startInFlight = undefined;
        }
    }
    /**
     * Require a ready launcher without ever spawning one. Used when
     * `autoStart` is off or the plugin is in `external` mode.
     * @param signal - caller cancellation.
     * @returns the reported load and health.
     * @throws LayaGoError `unreachable`, `not_ready`, or `start_failed`.
     */
    async requireReady(signal) {
        const probe = await this.deps.client.probe(signal);
        if (probe.kind === 'foreign') {
            throw new LayaGoError('start_failed', `${this.deps.config.baseUrl} answered, but not as a Laya launcher`, {
                hint: 'Something else is using that port; point baseUrl at the launcher or free the port.',
            });
        }
        if (probe.kind === 'absent') {
            throw new LayaGoError('unreachable', `no Laya service answered at ${this.deps.config.baseUrl}`, {
                hint: 'Start the launcher yourself, enable autoStart, or use laya_go_server with action "start".',
            });
        }
        if (probe.health.engine?.loaded === true) {
            return { started: false, adopted: this.handle === undefined, load: undefined, health: probe.health };
        }
        const waited = await this.waitForReady(undefined, signal);
        return { started: false, adopted: this.handle === undefined, ...waited };
    }
    /**
     * Terminate the process this plugin started. A launcher that this plugin did
     * not start is reported instead of killed.
     * @param signal - caller cancellation.
     * @returns whether a managed process was terminated.
     */
    async stop(signal) {
        const handle = this.handle;
        if (handle === undefined || this.adopted) {
            const probe = await this.deps.client.probe(signal);
            if (probe.kind === 'laya') {
                throw new LayaGoError('server_not_managed', `a Laya launcher answers at ${this.deps.config.baseUrl}, but this plugin did not start it`, {
                    hint: 'Stop it where it was started, or leave mode "external" so the plugin never manages it.',
                });
            }
            this.reset();
            return { stopped: false, forced: false };
        }
        this.stopping = true;
        this.state = 'stopping';
        try {
            return await this.terminate(handle);
        }
        finally {
            this.stopping = false;
            this.state = 'stopped';
        }
    }
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
    async dispose() {
        this.disposed = true;
        await this.shutdown();
    }
    /** Terminate the process this instance started, without poisoning later starts. */
    async shutdown() {
        const handle = this.handle;
        if (handle === undefined || this.adopted) {
            this.reset();
            return;
        }
        this.stopping = true;
        this.state = 'stopping';
        try {
            await this.terminate(handle);
        }
        catch (error) {
            this.deps.logger.warn(`laya-go-decision: launcher teardown failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        finally {
            this.stopping = false;
            this.reset();
        }
    }
    /** Reject any call that could start or adopt a launcher after unload. */
    assertLive() {
        if (!this.disposed)
            return;
        throw new LayaGoError('runtime_disposed', 'this plugin instance has been unloaded, so it will not start or reuse a launcher', {
            hint: 'Its configuration changed or it was reloaded; call again to reach the current instance.',
        });
    }
    /** Stop the managed process and wait for its whole range to go quiet. */
    async terminate(handle) {
        handle.terminate();
        const graceMs = this.deps.config.shutdownGraceMs;
        let quiet = false;
        try {
            quiet = await handle.waitForExit(AbortSignal.timeout(graceMs + 5000));
        }
        catch (error) {
            this.deps.logger.warn(`laya-go-decision: could not prove the launcher's process range is empty: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (!quiet) {
            this.deps.logger.warn(`laya-go-decision: launcher still running ${graceMs + 5000} ms after terminate()`);
        }
        if (this.handle === handle)
            this.handle = undefined;
        return { stopped: true, forced: !quiet };
    }
    /** Probe, adopt, or start. */
    async reachOrStart(signal) {
        // An unloaded instance must not adopt either: adoption would make it hold
        // state, and the next unload would report a launcher it does not own.
        this.assertLive();
        const probe = await this.deps.client.probe(signal);
        if (probe.kind === 'foreign') {
            throw new LayaGoError('start_failed', `${this.deps.config.baseUrl} answered, but not as a Laya launcher`, {
                hint: 'Something else is using that port; point baseUrl at the launcher or free the port.',
            });
        }
        if (probe.kind === 'laya') {
            if (this.handle === undefined) {
                this.adopted = true;
                this.state = 'running';
                this.deps.logger.info(`laya-go-decision: using the Laya launcher already running at ${this.deps.config.baseUrl}`);
            }
            if (probe.health.engine?.loaded === true) {
                return { started: false, adopted: this.adopted, load: undefined, health: probe.health };
            }
            const waited = await this.waitForReady(undefined, signal);
            return { started: false, adopted: this.adopted, ...waited };
        }
        if (this.deps.config.mode === 'external') {
            throw new LayaGoError('unreachable', `no Laya service answered at ${this.deps.config.baseUrl}`, {
                hint: 'Mode is "external", so the plugin never starts one. Start the launcher yourself, or switch mode to "managed".',
            });
        }
        return this.spawnAndWait(signal);
    }
    /** Resolve the executable, spawn it, and wait for the model. */
    async spawnAndWait(signal) {
        const subprocess = this.deps.getSubprocess();
        if (subprocess === undefined) {
            throw new LayaGoError('subprocess_missing', 'managed mode needs a ctx.subprocess provider, and none is mounted', {
                hint: 'Mount @deepseek-ai/dsh-subprocess-local in the composition, or set mode to "external".',
            });
        }
        const config = this.deps.config;
        let executable;
        try {
            executable = await subprocess.resolveExecutable(config.executable, config.env, signal);
        }
        catch (cause) {
            throw new LayaGoError('executable_missing', `could not resolve the launcher executable ${JSON.stringify(config.executable)}`, {
                hint: 'Set executable to an absolute path such as C:\\laya-go-launcher\\layatrt-server.exe, or add it to PATH.',
                cause,
            });
        }
        const argv = [executable, ...serverArgs(config)];
        this.deps.logger.info(`laya-go-decision: starting ${argv.join(' ')}`);
        const handle = subprocess.spawn({
            argv,
            cwd: config.serverCwd ?? process.cwd(),
            stdio: {
                stdin: 'ignore',
                stdout: { maxBytes: config.logBytes },
                stderr: { maxBytes: config.logBytes },
            },
            graceMs: config.shutdownGraceMs,
            ...config.env === undefined ? {} : { env: { ...config.env } },
        });
        this.handle = handle;
        this.adopted = false;
        this.state = 'starting';
        this.startedAt = new Date().toISOString();
        this.lastError = undefined;
        this.lastExit = undefined;
        void handle.done.then(outcome => this.onExit(handle, outcome), (cause) => this.onExit(handle, undefined, cause));
        try {
            const waited = await this.waitForReady(handle, signal);
            this.state = 'running';
            return { started: true, adopted: false, ...waited };
        }
        catch (error) {
            const failure = signal?.aborted === true
                ? new LayaGoError('aborted', 'the launcher start was aborted')
                : asLayaError(error, 'the launcher did not become ready');
            this.lastError = failure.message;
            // Clean up this attempt only: the instance stays live, so the next call
            // may try again.
            await this.shutdown();
            throw failure;
        }
    }
    /**
     * Poll `/api/v1/load` until the model is ready, failing early when the load
     * failed, the process exited, or the launcher never begins loading.
     */
    async waitForReady(handle, callerSignal) {
        const controller = new AbortController();
        const onCallerAbort = () => controller.abort();
        callerSignal?.addEventListener('abort', onCallerAbort, { once: true });
        try {
            const polled = this.pollUntilReady(controller.signal).then(value => ({ kind: 'ready', value }), (error) => ({ kind: 'failed', error }));
            const result = handle === undefined
                ? await polled
                : await Promise.race([
                    polled,
                    handle.done.then((outcome) => ({ kind: 'exited', outcome }), () => ({ kind: 'exited', outcome: { exitCode: null, signal: null } })),
                ]);
            if (result.kind === 'ready')
                return result.value;
            if (result.kind === 'failed') {
                if (callerAborted(callerSignal)) {
                    throw new LayaGoError('aborted', 'the launcher start was aborted');
                }
                throw asLayaError(result.error, 'the launcher did not become ready');
            }
            throw this.exitError(handle, result.outcome);
        }
        finally {
            callerSignal?.removeEventListener('abort', onCallerAbort);
            controller.abort();
        }
    }
    /** The polling loop behind {@link waitForReady}. */
    async pollUntilReady(signal) {
        const config = this.deps.config;
        const deadline = Date.now() + config.startTimeoutMs;
        let idleSince;
        while (true) {
            if (signal.aborted)
                throw new LayaGoError('aborted', 'the launcher start was aborted');
            let load;
            try {
                load = await this.deps.client.loadState({ signal });
            }
            catch (error) {
                if (error instanceof LayaGoError && error.code === 'aborted')
                    throw error;
                // Not listening yet, or the endpoint is not readable: keep polling.
                load = undefined;
            }
            const now = Date.now();
            if (load !== undefined) {
                if (load.phase === 'ready') {
                    const health = await this.deps.client.health({ signal }).catch(() => undefined);
                    return { load, health };
                }
                if (load.phase === 'failed') {
                    const hint = attemptsSummary(load);
                    throw new LayaGoError('start_failed', `the launcher failed to load a model${load.error === undefined ? '' : `: ${load.error}`}`, {
                        ...hint === undefined ? {} : { hint },
                        ...load.error === undefined ? {} : { detail: load.error },
                    });
                }
                if (load.phase === 'loading') {
                    idleSince = undefined;
                }
                else {
                    idleSince ??= now;
                    if (now - idleSince >= config.loadIdleGraceMs) {
                        throw new LayaGoError('not_ready', 'the launcher is listening, but no model load is running', {
                            hint: 'It may have been started with --no-load or found no model file. Start it with a model, or POST /api/v1/load/auto.',
                        });
                    }
                }
            }
            const remaining = deadline - now;
            if (remaining <= 0) {
                throw new LayaGoError('start_timeout', `the model was not ready within ${config.startTimeoutMs} ms`, {
                    hint: 'Raise startTimeoutMs for a large plan, and check the launcher log for load progress.',
                });
            }
            await delay(Math.min(config.readyPollMs, remaining), signal);
        }
    }
    /** Build the failure for a launcher that exited before it was ready. */
    exitError(handle, outcome) {
        const tail = handle === undefined ? undefined : this.stderrTail(handle);
        const code = outcome.exitCode === null
            ? `signal ${outcome.signal ?? 'unknown'}`
            : `exit code ${outcome.exitCode}`;
        return new LayaGoError('server_exited', `the launcher exited (${code}) before its model was ready`, {
            hint: tail === undefined ? 'Check the launcher configuration and the executable path.' : `Last launcher output: ${tail}`,
        });
    }
    /** Read the retained stderr tail, which is where launcher diagnostics land. */
    stderrTail(handle) {
        try {
            const text = handle.collected.stderr?.readFrom(0).text.trim();
            if (text === undefined || text === '')
                return undefined;
            return text.length > 800 ? `…${text.slice(-800)}` : text;
        }
        catch {
            return undefined;
        }
    }
    /**
     * Record a process exit. Only the handle the supervisor still considers
     * current may move the state, so an exit that arrives after an intentional
     * stop or a restart cannot overwrite the newer state.
     */
    onExit(handle, outcome, cause) {
        const current = this.handle === handle;
        if (current)
            this.handle = undefined;
        if (outcome !== undefined)
            this.lastExit = outcome;
        if (this.stopping || !current) {
            if (this.stopping)
                this.state = 'stopped';
            return;
        }
        const code = outcome === undefined
            ? 'unknown'
            : outcome.exitCode === null ? `signal ${outcome.signal ?? 'unknown'}` : `exit code ${outcome.exitCode}`;
        const detail = cause instanceof Error ? `: ${cause.message}` : '';
        this.lastError = `the launcher exited (${code})${detail}`;
        this.state = 'failed';
        this.deps.logger.warn(`laya-go-decision: ${this.lastError}`);
    }
    /** Clear all process state. */
    reset() {
        this.handle = undefined;
        this.adopted = false;
        this.state = 'stopped';
        this.startedAt = undefined;
    }
}
/**
 * Build one normalized configuration and its client and supervisor.
 * @param rawConfig - loader-validated configuration.
 * @param logger - plugin logger.
 * @param getSubprocess - lazy `ctx.subprocess` accessor.
 * @returns the normalized config, client, and supervisor.
 */
export function createServerRuntime(rawConfig, logger, getSubprocess) {
    const config = normalizeConfig(rawConfig);
    const client = new LayaClient({
        apiBaseUrl: config.apiBaseUrl,
        requestTimeoutMs: config.requestTimeoutMs,
        probeTimeoutMs: config.probeTimeoutMs,
        ...config.adminToken === undefined ? {} : { adminToken: config.adminToken },
    });
    const supervisor = new LayaServerSupervisor({ config, client, logger, getSubprocess });
    return { config, client, supervisor };
}
//# sourceMappingURL=supervisor.js.map