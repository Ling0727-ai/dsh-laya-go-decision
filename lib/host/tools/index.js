/**
 * The plugin's model-facing tool roster.
 *
 * @module dsh-laya-go-decision/host/tools
 */
import { registerDecideTool } from "./decide.js";
import { registerServerTool } from "./server.js";
import { registerStatusTool } from "./status.js";
export { registerDecideTool, registerServerTool, registerStatusTool };
/**
 * Register every tool this plugin contributes. Registration is an effect of the
 * calling plugin, so unloading the plugin removes all three.
 * @param ctx - plugin context providing `ctx.tools`.
 * @param service - the decision service behind the tools.
 */
export function registerLayaGoTools(ctx, service) {
    registerDecideTool(ctx, service);
    registerStatusTool(ctx, service);
    registerServerTool(ctx, service);
}
//# sourceMappingURL=index.js.map