/**
 * `laya_go_decide`: answer typed questions about one state with the local
 * Laya Go Launcher model in a single forward pass.
 *
 * The tool is a thin projection of `ctx.layaGoDecision.decide`. The description
 * states the budget the deployment actually configured, so the model knows how
 * much state it may pass and how many questions fit one call.
 *
 * @module dsh-laya-go-decision/host/tools/decide
 */
import type { Context } from '@deepseek-ai/cordis';
import type { LayaGoDecisionService } from '../service.ts';
/**
 * Register `laya_go_decide`.
 * @param ctx - plugin context providing `ctx.tools`.
 * @param service - the decision service.
 */
export declare function registerDecideTool(ctx: Context, service: LayaGoDecisionService): void;
//# sourceMappingURL=decide.d.ts.map