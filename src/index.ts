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

import type { Context } from '@deepseek-ai/cordis'
// Type-only imports: they bring the `ctx.tools` and `ctx.subprocess` service
// declarations into scope without adding a runtime dependency.
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-tools'
import { Config, type Config as LayaGoConfig } from './host/config.ts'
import { LayaGoDecisionService } from './host/service.ts'
import { createServerRuntime } from './host/supervisor.ts'
import { registerLayaGoTools } from './host/tools/index.ts'

/** Cordis plugin name, used by Loader diagnostics. */
export const name = 'laya-go-decision'

/**
 * `tools` is a hard requirement: without the tool registry the plugin has
 * nothing to contribute. `subprocess` is a `ctx.get` optional dependency, because
 * `external` mode never starts a process and must load in a composition without
 * a subprocess provider.
 */
export const inject = ['tools']

export { Config }
export type { LayaGoConfig }

export { LayaClient, type LayaProbe, type LayaRequestOptions } from './host/client.ts'
export { normalizeConfig, serverArgs, type NormalizedConfig } from './host/config.ts'
export { LayaGoError, type LayaGoErrorCode } from './host/errors.ts'
export {
  parseHealth,
  parseLoadState,
  parseMetrics,
  parsePredictResponse,
  type LayaAnswer,
  type LayaHealth,
  type LayaLoadState,
  type LayaMetrics,
  type LayaPredictRequest,
  type LayaPredictResponse,
  type LayaQuestionSpec,
  type LayaQuestionType,
} from './host/protocol.ts'
export {
  LayaGoDecisionService,
  parseQuestions,
  type LayaDecisionAnswer,
  type LayaDecisionResult,
  type LayaQuestionInput,
  type LayaRuntime,
  type LayaServerStartResult,
  type LayaServerStopResult,
  type LayaStatusResult,
} from './host/service.ts'
export {
  LayaServerSupervisor,
  createServerRuntime,
  type LayaLogger,
  type LayaReadyOutcome,
  type LayaServerSnapshot,
  type LayaServerState,
  type LayaStopOutcome,
} from './host/supervisor.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The decision service provided by this plugin. */
    layaGoDecision: LayaGoDecisionService
  }
}

/**
 * Plugin body: build the runtime, provide `ctx.layaGoDecision`, register the
 * tools, and give the managed launcher a teardown hook.
 * @param ctx - host context whose fiber owns every registration below.
 * @param config - loader-validated plugin configuration.
 */
export function apply(ctx: Context, config: LayaGoConfig): void {
  const { config: normalized, client, supervisor } = createServerRuntime(
    config,
    ctx.logger,
    () => ctx.get('subprocess'),
  )
  // The launcher process is not a Cordis resource, so its lifetime is an effect:
  // unloading the plugin (or hot-replacing its config) terminates the managed
  // process range.
  ctx.effect(() => () => supervisor.dispose())
  const service = new LayaGoDecisionService(ctx, { config: normalized, client, supervisor })
  registerLayaGoTools(ctx, service)
}
