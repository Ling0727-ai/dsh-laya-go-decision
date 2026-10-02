/**
 * `laya_go_server`: start, stop, or restart the managed launcher process.
 *
 * This is the only tool that changes process state, so it is the only one that
 * is not concurrency-safe. `stop` deliberately refuses to kill a launcher the
 * plugin did not start: an adopted server may be shared with another session.
 *
 * @module dsh-laya-go-decision/host/tools/server
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { LayaGoDecisionService } from '../service.ts'

/**
 * Register `laya_go_server`.
 * @param ctx - plugin context providing `ctx.tools`.
 * @param service - the decision service.
 */
export function registerServerTool(ctx: Context, service: LayaGoDecisionService): void {
  const config = service.config
  ctx.tools.register(defineTool({
    name: 'laya_go_server',
    description: [
      'Control the managed Laya Go Launcher process.',
      '`start` makes the launcher ready now: it starts the configured executable in managed mode, and adopts a launcher that is already running at baseUrl instead of starting a second one.',
      '`stop` terminates only the process this plugin started; if something else is serving baseUrl, it reports that instead of killing it.',
      '`restart` stops that same managed process and starts it again.',
      `Configuration comes from the plugin row: mode ${config.mode}, executable ${config.executable}, baseUrl ${config.baseUrl}.`,
      'Readiness waits for the model itself, so a successful start means predictions will work.',
    ].join(' '),
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['start', 'stop', 'restart'],
        description: 'start: make it ready now; stop: terminate the managed process; restart: stop then start.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', required: true },
          state: { type: 'string', required: true, description: 'Supervisor state after the action.' },
          started: { type: 'boolean', description: 'True when this call started a process.' },
          adopted: { type: 'boolean', description: 'True when an already running launcher was used.' },
          ready: { type: 'boolean', description: 'True when the model reported ready.' },
          stopped: { type: 'boolean', description: 'True when a managed process was terminated.' },
          forced: { type: 'boolean', description: 'True when termination exceeded its grace period.' },
          phase: { type: 'string', description: 'Launcher load phase after a start.' },
          message: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `${value.action}: ${value.message}` }],
    },
    // `restart` may spend a teardown grace plus a full start-to-ready window.
    timeoutMs: config.startTimeoutMs + config.shutdownGraceMs + 15_000,
    // Mutates process lifetime; never share a dispatch group with another call.
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      if (args.action === 'stop') {
        const stopped = await service.stopServer(exec.signal)
        return {
          action: args.action,
          state: stopped.server.state,
          stopped: stopped.stopped,
          forced: stopped.forced,
          message: stopped.stopped
            ? stopped.forced
              ? 'the launcher was terminated, but its process range was still busy after the grace period'
              : 'the launcher this plugin started has been terminated'
            : 'no managed launcher was running; nothing was terminated',
        }
      }
      if (args.action === 'restart') {
        const stopped = await service.stopServer(exec.signal)
        const startResult = await service.startServer(exec.signal)
        return {
          action: args.action,
          state: startResult.server.state,
          started: startResult.started,
          adopted: startResult.adopted,
          ready: startResult.ready,
          stopped: stopped.stopped,
          forced: stopped.forced,
          ...startResult.load === undefined ? {} : { phase: startResult.load.phase },
          message: [
            stopped.stopped ? 'the previous managed launcher was terminated' : 'no managed launcher was running',
            startResult.started ? 'and a new one is ready' : 'and an existing one is serving requests',
          ].join(', '),
        }
      }
      const started = await service.startServer(exec.signal)
      return {
        action: args.action,
        state: started.server.state,
        started: started.started,
        adopted: started.adopted,
        ready: started.ready,
        ...started.load === undefined ? {} : { phase: started.load.phase },
        message: [
          started.started ? 'the launcher was started and its model is ready' : 'an already running launcher is being used',
          started.adopted ? '(adopted, not owned by this plugin)' : '',
        ].filter(part => part !== '').join(' '),
      }
    },
  }))
}
