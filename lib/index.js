/**
 * dsh-laya-go-decision — host half.
 *
 * A background decision plugin over [Laya Go Launcher](https://github.com/Ling0727-ai/Laya-Go-Launcher),
 * a local inference server that answers typed questions about a text with one
 * shared forward pass (`choice`, `score`, `noul`). This plugin owns two things:
 *
 * - the launcher's process lifetime, through `ctx.subprocess`, so managed mode
 *   starts no window and leaves no process behind when the plugin unloads;
 * - the model-facing tools, which are thin projections of the
 *   `ctx.layaGoDecision` service defined here.
 *
 * It deliberately does not reimplement inference, model selection, or the
 * fallback chain: the launcher owns those, and the plugin talks to it over
 * loopback HTTP.
 *
 * @module dsh-laya-go-decision
 */
import { Config } from "./host/config.js";
import { LayaGoDecisionService } from "./host/service.js";
import { createServerRuntime } from "./host/supervisor.js";
import { registerLayaGoTools } from "./host/tools/index.js";
/** Cordis plugin name, used by Loader diagnostics. */
export const name = 'laya-go-decision';
/**
 * `tools` is a hard requirement: without the tool registry the plugin has
 * nothing to contribute. `subprocess` is a `ctx.get` optional dependency, because
 * `external` mode never starts a process and must load in a composition without
 * a subprocess provider.
 */
export const inject = ['tools'];
export { Config };
export { LayaClient } from "./host/client.js";
export { normalizeConfig, serverArgs } from "./host/config.js";
export { LayaGoError } from "./host/errors.js";
export { parseHealth, parseLoadState, parseMetrics, parsePredictResponse, } from "./host/protocol.js";
export { LayaGoDecisionService, parseQuestions, } from "./host/service.js";
export { LayaServerSupervisor, createServerRuntime, } from "./host/supervisor.js";
/**
 * Plugin body: build the runtime, provide `ctx.layaGoDecision`, register the
 * tools, and give the managed launcher a teardown hook.
 * @param ctx - host context whose fiber owns every registration below.
 * @param config - loader-validated plugin configuration.
 */
export function apply(ctx, config) {
    const { config: normalized, client, supervisor } = createServerRuntime(config, ctx.logger, () => ctx.get('subprocess'));
    // The launcher process is not a Cordis resource, so its lifetime is an effect:
    // unloading the plugin (or hot-replacing its config) terminates the managed
    // process range.
    ctx.effect(() => () => supervisor.dispose());
    const service = new LayaGoDecisionService(ctx, { config: normalized, client, supervisor });
    registerLayaGoTools(ctx, service);
}
//# sourceMappingURL=index.js.map