/**
 * `laya_go_status`: read-only report about the Laya Go Launcher.
 *
 * It answers the three questions a caller actually has — is anything there, is a
 * model loaded, and how is it performing — without ever starting or stopping a
 * process. An unreachable launcher is a normal result here, not a failure.
 *
 * @module dsh-laya-go-decision/host/tools/status
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { LayaGoDecisionService } from '../service.ts'
import { millis, round } from './format.ts'

/**
 * Register `laya_go_status`.
 * @param ctx - plugin context providing `ctx.tools`.
 * @param service - the decision service.
 */
export function registerStatusTool(ctx: Context, service: LayaGoDecisionService): void {
  const config = service.config
  ctx.tools.register(defineTool({
    name: 'laya_go_status',
    description: [
      'Report the local Laya Go Launcher: whether it answers, which model, kernel, and device are loaded, the last load\'s fallback attempts, and prediction counters.',
      'Read-only: it never starts, stops, or loads anything.',
      'Use it to check whether a decision call is worth attempting, or to explain why one failed.',
    ].join(' '),
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          reachable: { type: 'boolean', required: true },
          mode: { type: 'string', required: true },
          baseUrl: { type: 'string', required: true },
          server: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              state: { type: 'string', required: true },
              owned: { type: 'boolean', required: true },
              adopted: { type: 'boolean', required: true },
              startedAt: { type: 'string' },
              argv: { type: 'array', required: true, items: { type: 'string' } },
            },
          },
          engine: {
            type: 'object',
            additionalProperties: false,
            properties: {
              loaded: { type: 'boolean', required: true },
              path: { type: 'string' },
              backend: { type: 'string' },
              contexts: { type: 'number' },
            },
          },
          device: { type: 'string' },
          backend: { type: 'string' },
          note: { type: 'string' },
          version: { type: 'string' },
          load: {
            type: 'object',
            additionalProperties: false,
            properties: {
              phase: { type: 'string', required: true },
              backend: { type: 'string' },
              path: { type: 'string' },
              device: { type: 'string' },
              error: { type: 'string' },
              failedAttempts: { type: 'array', required: true, items: { type: 'string' } },
            },
          },
          metrics: {
            type: 'object',
            additionalProperties: false,
            properties: {
              requestsTotal: { type: 'number' },
              requestsFailed: { type: 'number' },
              predictTotal: { type: 'number' },
              p50Ms: { type: 'number' },
              p99Ms: { type: 'number' },
            },
          },
          error: {
            type: 'object',
            additionalProperties: false,
            properties: {
              code: { type: 'string', required: true },
              message: { type: 'string', required: true },
              hint: { type: 'string' },
            },
          },
        },
      },
      render: (_args, value) => {
        const lines: string[] = []
        const where = `${value.baseUrl} (mode ${value.mode})`
        lines.push(value.reachable
          ? `Laya Go Launcher is answering at ${where}.`
          : `Laya Go Launcher is not answering at ${where}.`)
        if (value.error !== undefined) {
          lines.push(`- ${value.error.message}${value.error.hint === undefined ? '' : ` ${value.error.hint}`}`)
        }
        lines.push(`- managed process: ${value.server.state}${value.server.adopted ? ' (adopted, not owned by this plugin)' : ''}`)
        if (value.version !== undefined) lines.push(`- launcher version: ${value.version}`)
        if (value.load !== undefined) {
          const parts = [`load phase ${value.load.phase}`]
          if (value.load.backend !== undefined) parts.push(`kernel ${value.load.backend}`)
          if (value.load.device !== undefined) parts.push(value.load.device)
          if (value.load.path !== undefined) parts.push(value.load.path)
          if (value.load.error !== undefined) parts.push(`error: ${value.load.error}`)
          if (value.load.failedAttempts.length > 0) parts.push(`failed attempts: ${value.load.failedAttempts.join('; ')}`)
          lines.push(`- ${parts.join(', ')}`)
        }
        if (value.engine !== undefined) {
          lines.push(`- engine: ${value.engine.loaded ? 'loaded' : 'not loaded'}${value.engine.backend === undefined ? '' : ` on ${value.engine.backend}`}${value.engine.path === undefined ? '' : ` (${value.engine.path})`}`)
        }
        if (value.backend !== undefined) lines.push(`- kernel: ${value.backend}${value.note === undefined ? '' : ` — ${value.note}`}`)
        if (value.device !== undefined) lines.push(`- device: ${value.device}`)
        if (value.metrics !== undefined) {
          const latency = [value.metrics.p50Ms === undefined ? undefined : `p50 ${millis(value.metrics.p50Ms)}`, value.metrics.p99Ms === undefined ? undefined : `p99 ${millis(value.metrics.p99Ms)}`]
            .filter(part => part !== undefined)
          lines.push([
            `- predictions: ${value.metrics.predictTotal ?? 0}`,
            value.metrics.requestsFailed === undefined ? undefined : `failed ${value.metrics.requestsFailed}`,
            latency.length === 0 ? undefined : `latency ${latency.join(', ')}`,
          ].filter(part => part !== undefined).join(', '))
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    // The probe plus health, load, and metrics can each spend a full request budget.
    timeoutMs: config.probeTimeoutMs + 3 * config.requestTimeoutMs,
    // Pure observation.
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      const status = await service.status(exec.signal)
      const failedAttempts = status.load === undefined
        ? []
        : status.load.attempts
          .filter(attempt => attempt.skipped !== true && attempt.ok !== true)
          .map(attempt => `${attempt.backend ?? attempt.provider ?? attempt.model ?? 'attempt'}: ${attempt.error ?? 'no reason reported'}`)
      const latency = status.metrics?.latency
      return {
        reachable: status.reachable,
        mode: status.mode,
        baseUrl: status.baseUrl,
        server: {
          state: status.server.state,
          owned: status.server.owned,
          adopted: status.server.adopted,
          ...status.server.startedAt === undefined ? {} : { startedAt: status.server.startedAt },
          argv: [...status.server.argv],
        },
        ...status.health?.engine === undefined ? {} : {
          engine: {
            loaded: status.health.engine.loaded,
            ...status.health.engine.path === undefined ? {} : { path: status.health.engine.path },
            ...status.health.engine.backend === undefined ? {} : { backend: status.health.engine.backend },
            ...status.health.engine.contexts === undefined ? {} : { contexts: status.health.engine.contexts },
          },
        },
        ...status.health?.device?.name === undefined ? {} : { device: status.health.device.name },
        ...status.health?.backend?.selected === undefined ? {} : { backend: status.health.backend.selected },
        ...status.health?.backend?.note === undefined ? {} : { note: status.health.backend.note },
        ...status.health?.version === undefined ? {} : { version: status.health.version },
        ...status.load === undefined ? {} : {
          load: {
            phase: status.load.phase,
            ...status.load.backend === undefined ? {} : { backend: status.load.backend },
            ...status.load.path === undefined ? {} : { path: status.load.path },
            ...status.load.device === undefined ? {} : { device: status.load.device },
            ...status.load.error === undefined ? {} : { error: status.load.error },
            failedAttempts,
          },
        },
        ...status.metrics === undefined ? {} : {
          metrics: {
            ...status.metrics.requestsTotal === undefined ? {} : { requestsTotal: status.metrics.requestsTotal },
            ...status.metrics.requestsFailed === undefined ? {} : { requestsFailed: status.metrics.requestsFailed },
            ...status.metrics.predictTotal === undefined ? {} : { predictTotal: status.metrics.predictTotal },
            ...latency?.p50 === undefined ? {} : { p50Ms: round(latency.p50, 3) },
            ...latency?.p99 === undefined ? {} : { p99Ms: round(latency.p99, 3) },
          },
        },
        ...status.error === undefined ? {} : {
          error: {
            code: status.error.code,
            message: status.error.message,
            ...status.error.hint === undefined ? {} : { hint: status.error.hint },
          },
        },
      }
    },
  }))
}
