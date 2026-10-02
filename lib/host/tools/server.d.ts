/**
 * `laya_go_server`: start, stop, or restart the managed launcher process.
 *
 * This is the only tool that changes process state, so it is the only one that
 * is not concurrency-safe. `stop` deliberately refuses to kill a launcher the
 * plugin did not start: an adopted server may be shared with another session.
 *
 * @module dsh-laya-go-decision/host/tools/server
 */
import type { Context } from '@deepseek-ai/cordis';
import type { LayaGoDecisionService } from '../service.ts';
/**
 * Register `laya_go_server`.
 * @param ctx - plugin context providing `ctx.tools`.
 * @param service - the decision service.
 */
export declare function registerServerTool(ctx: Context, service: LayaGoDecisionService): void;
//# sourceMappingURL=server.d.ts.map