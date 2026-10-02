/**
 * The plugin's model-facing tool roster.
 *
 * @module dsh-laya-go-decision/host/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import type { LayaGoDecisionService } from '../service.ts'
import { registerDecideTool } from './decide.ts'
import { registerServerTool } from './server.ts'
import { registerStatusTool } from './status.ts'

export { registerDecideTool, registerServerTool, registerStatusTool }

/**
 * Register every tool this plugin contributes. Registration is an effect of the
 * calling plugin, so unloading the plugin removes all three.
 * @param ctx - plugin context providing `ctx.tools`.
 * @param service - the decision service behind the tools.
 */
export function registerLayaGoTools(ctx: Context, service: LayaGoDecisionService): void {
  registerDecideTool(ctx, service)
  registerStatusTool(ctx, service)
  registerServerTool(ctx, service)
}
