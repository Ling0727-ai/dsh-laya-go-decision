/**
 * `laya_go_status`: read-only report about the Laya Go Launcher.
 *
 * It answers the three questions a caller actually has — is anything there, is a
 * model loaded, and how is it performing — without ever starting or stopping a
 * process. An unreachable launcher is a normal result here, not a failure.
 *
 * @module dsh-laya-go-decision/host/tools/status
 */
import type { Context } from '@deepseek-ai/cordis';
import type { LayaGoDecisionService } from '../service.ts';
/**
 * Register `laya_go_status`.
 * @param ctx - plugin context providing `ctx.tools`.
 * @param service - the decision service.
 */
export declare function registerStatusTool(ctx: Context, service: LayaGoDecisionService): void;
//# sourceMappingURL=status.d.ts.map