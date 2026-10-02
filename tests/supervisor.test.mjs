/**
 * Managed-mode tests: process spawning through `ctx.subprocess`, adoption of an
 * already running launcher, readiness semantics, failure reporting, and
 * teardown.
 *
 * Each test registers its plugin context and any fake launcher with `t.after`,
 * so neither a passing nor a failing assertion can leak a listening socket.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { Config, apply } from '../lib/index.js'
import {
  createFakeContext,
  createFakeSubprocess,
  reservePort,
  startFakeLaya,
  startForeignServer,
} from './helpers/fakes.mjs'

/**
 * Apply the plugin in managed mode against one fake subprocess provider.
 * @param t - test context used for cleanup.
 * @param options - reserved port, fake subprocess, and config overrides.
 */
function managedService(t, options = {}) {
  const fake = createFakeContext({ subprocess: options.subprocess })
  t.after(() => fake.dispose())
  apply(fake.ctx, Config({
    mode: 'managed',
    baseUrl: `http://127.0.0.1:${options.port}`,
    executable: 'layatrt-server.exe',
    startTimeoutMs: 5000,
    readyPollMs: 50,
    ...options.config,
  }))
  return { fake, service: fake.services.get('layaGoDecision') }
}

test('managed start spawns the launcher, waits for the model, and owns it', async (t) => {
  const port = await reservePort()
  const { service: subprocess, spawns } = createFakeSubprocess()
  const { fake, service } = managedService(t, { port, subprocess, config: { args: ['--no-convert'] } })

  const started = await service.startServer()
  assert.equal(started.started, true)
  assert.equal(started.adopted, false)
  assert.equal(started.ready, true)
  assert.equal(started.server.state, 'running')
  assert.equal(started.server.owned, true)
  assert.equal(started.load.phase, 'ready')

  assert.equal(spawns.length, 1)
  const argv = spawns[0].spec.argv
  assert.equal(argv[0], 'layatrt-server.exe')
  // `baseUrl` stays the single source of truth for the listen address.
  assert.deepEqual(argv.slice(1, 3), ['--no-convert', '--addr'])
  assert.equal(argv[3], `127.0.0.1:${port}`)
  assert.equal(spawns[0].spec.stdio.stdin, 'ignore')
  assert.equal(spawns[0].spec.stdio.stderr.maxBytes, 16_384)
  assert.equal(spawns[0].spec.cwd, process.cwd())

  // The decision path reuses the running launcher instead of spawning again.
  const decided = await service.decide('We were billed twice.', [
    { id: 'department', type: 'choice', instructions: 'Which team?', criteria: { billing: 'refunds', technical: 'bugs' } },
  ])
  assert.equal(decided.server.started, false)
  assert.equal(decided.server.adopted, false)
  assert.equal(spawns.length, 1)
  await fake.dispose()
})

test('stop terminates only the process the plugin started', async (t) => {
  const port = await reservePort()
  const { service: subprocess, spawns } = createFakeSubprocess()
  const { fake, service } = managedService(t, { port, subprocess })
  await service.startServer()

  const stopped = await service.stopServer()
  assert.equal(stopped.stopped, true)
  assert.equal(stopped.forced, false)
  assert.equal(stopped.server.state, 'stopped')
  assert.equal(spawns[0].state.terminated, 1)

  const again = await service.stopServer()
  assert.equal(again.stopped, false)
  await fake.dispose()
})

test('disposing the plugin terminates a managed launcher', async (t) => {
  const port = await reservePort()
  const { service: subprocess, spawns } = createFakeSubprocess()
  const { fake, service } = managedService(t, { port, subprocess })
  await service.startServer()
  await fake.dispose()
  assert.equal(spawns[0].state.terminated, 1)
  assert.equal(service.runtime.supervisor.snapshot().state, 'stopped')
})

test('an already running launcher is adopted, never killed', async (t) => {
  const port = await reservePort()
  const launcher = await startFakeLaya({ port })
  t.after(() => launcher.close())
  const { service: subprocess, spawns } = createFakeSubprocess()
  const { fake, service } = managedService(t, { port, subprocess })

  const started = await service.startServer()
  assert.equal(started.started, false)
  assert.equal(started.adopted, true)
  assert.equal(started.server.adopted, true)
  assert.equal(started.load, undefined, 'an adopted launcher is used exactly as it is')
  assert.equal(spawns.length, 0, 'no second process is started for an occupied port')

  await assert.rejects(
    () => service.stopServer(),
    error => error.code === 'server_not_managed',
  )
  await fake.dispose()
  // The adopted launcher keeps serving after the plugin unloaded.
  const status = await service.status()
  assert.equal(status.reachable, true)
})

test('a foreign service on the port is reported instead of spawning into it', async (t) => {
  const foreign = await startForeignServer()
  t.after(() => foreign.close())
  const port = Number.parseInt(new URL(foreign.baseUrl).port, 10)
  const { service: subprocess, spawns } = createFakeSubprocess()
  const { fake, service } = managedService(t, { port, subprocess })
  await assert.rejects(
    () => service.startServer(),
    error => error.code === 'start_failed' && /not as a Laya launcher/.test(error.message),
  )
  assert.equal(spawns.length, 0)
  await fake.dispose()
})

test('managed mode without a subprocess provider explains the missing seam', async (t) => {
  const port = await reservePort()
  const { fake, service } = managedService(t, { port, subprocess: undefined })
  await assert.rejects(
    () => service.startServer(),
    error => error.code === 'subprocess_missing',
  )
  await fake.dispose()
})

test('an unresolvable executable is reported before spawning', async (t) => {
  const port = await reservePort()
  const { service: subprocess, spawns } = createFakeSubprocess({ executableMissing: true })
  const { fake, service } = managedService(t, { port, subprocess })
  await assert.rejects(
    () => service.startServer(),
    error => error.code === 'executable_missing' && /layatrt-server\.exe/.test(error.message),
  )
  assert.equal(spawns.length, 0)
  await fake.dispose()
})

test('a launcher that exits before readiness reports its exit and its log tail', async (t) => {
  const port = await reservePort()
  const { service: subprocess } = createFakeSubprocess({
    exitImmediately: true,
    exitCode: 2,
    stderrText: 'no tokenizer.json found',
  })
  const { fake, service } = managedService(t, { port, subprocess })
  await assert.rejects(
    () => service.startServer(),
    error => {
      assert.equal(error.code, 'server_exited')
      assert.match(error.message, /exit code 2/)
      assert.match(error.hint, /no tokenizer\.json found/)
      return true
    },
  )
  assert.equal(service.runtime.supervisor.snapshot().state, 'stopped')
  await fake.dispose()
})

test('a failed load is reported with its fallback attempts', async (t) => {
  const port = await reservePort()
  const { service: subprocess } = createFakeSubprocess({
    launcher: {
      load: {
        phase: 'failed',
        error: 'plan deserialize failed',
        attempts: [
          { backend: 'tensorrt', ok: false, error: 'deserialize failed' },
          { backend: 'onnx-cpu', skipped: true, error: 'runtime missing' },
        ],
      },
    },
  })
  const { fake, service } = managedService(t, { port, subprocess })
  await assert.rejects(
    () => service.startServer(),
    error => {
      assert.equal(error.code, 'start_failed')
      assert.match(error.message, /plan deserialize failed/)
      assert.match(error.hint, /tensorrt: deserialize failed/)
      return true
    },
  )
  await fake.dispose()
})

test('a launcher that never starts loading is reported after the idle grace', async (t) => {
  const port = await reservePort()
  const { service: subprocess } = createFakeSubprocess({
    launcher: { load: { phase: 'idle', attempts: [] }, health: { engine: { loaded: false } } },
  })
  const { fake, service } = managedService(t, {
    port,
    subprocess,
    config: { loadIdleGraceMs: 200, readyPollMs: 50 },
  })
  await assert.rejects(
    () => service.startServer(),
    error => error.code === 'not_ready' && /no model load is running/.test(error.message),
  )
  await fake.dispose()
})

test('a load that never finishes hits the configured start timeout', async (t) => {
  const port = await reservePort()
  const { service: subprocess } = createFakeSubprocess({
    launcher: { load: { phase: 'loading' }, health: { engine: { loaded: false } } },
  })
  const { fake, service } = managedService(t, {
    port,
    subprocess,
    config: { startTimeoutMs: 1000, readyPollMs: 50, loadIdleGraceMs: 10_000 },
  })
  await assert.rejects(
    () => service.startServer(),
    error => error.code === 'start_timeout' && /within 1000 ms/.test(error.message),
  )
  await fake.dispose()
})

test('an aborted start stops waiting and terminates the process it started', async (t) => {
  const port = await reservePort()
  const { service: subprocess, spawns } = createFakeSubprocess({
    launcher: { load: { phase: 'loading' }, health: { engine: { loaded: false } } },
  })
  const { fake, service } = managedService(t, {
    port,
    subprocess,
    config: { startTimeoutMs: 10_000, readyPollMs: 50, loadIdleGraceMs: 10_000 },
  })
  const controller = new AbortController()
  const pending = service.startServer(controller.signal)
  setTimeout(() => controller.abort(), 150)
  await assert.rejects(() => pending, error => error.code === 'aborted')
  assert.equal(spawns[0].state.terminated, 1)
  assert.equal(service.runtime.supervisor.snapshot().state, 'stopped')
  await fake.dispose()
})

test('external mode never starts a process', async (t) => {
  const port = await reservePort()
  const { service: subprocess, spawns } = createFakeSubprocess()
  const fake = createFakeContext({ subprocess })
  t.after(() => fake.dispose())
  apply(fake.ctx, Config({ mode: 'external', baseUrl: `http://127.0.0.1:${port}` }))
  const service = fake.services.get('layaGoDecision')
  await assert.rejects(
    () => service.startServer(),
    error => error.code === 'unreachable' && /Mode is "external"/.test(error.hint),
  )
  assert.equal(spawns.length, 0)
  await fake.dispose()
})

test('an unloaded instance refuses to start anything, so nothing can be orphaned', async (t) => {
  const port = await reservePort()
  const { service: subprocess, spawns } = createFakeSubprocess()
  const { fake, service } = managedService(t, { port, subprocess })
  await service.startServer()
  assert.equal(spawns.length, 1)

  // The config hot-replace path: the old instance unloads and a fresh one mounts.
  await fake.dispose()
  await assert.rejects(
    () => service.startServer(),
    error => {
      assert.equal(error.code, 'runtime_disposed')
      assert.match(error.message, /has been unloaded/)
      return true
    },
  )
  await assert.rejects(
    () => service.decide('state', [{ id: 'a', type: 'noul', instructions: 'y?' }]),
    error => error.code === 'runtime_disposed',
  )
  assert.equal(spawns.length, 1, 'a disposed instance starts no second launcher')
})

test('a failed start leaves the instance usable for a retry', async (t) => {
  const port = await reservePort()
  const { service: subprocess, spawns } = createFakeSubprocess({
    launcher: {
      load: {
        phase: 'failed',
        error: 'plan deserialize failed',
        attempts: [{ backend: 'tensorrt', ok: false, error: 'deserialize failed' }],
      },
    },
  })
  const { fake, service } = managedService(t, { port, subprocess })
  await assert.rejects(() => service.startServer(), error => error.code === 'start_failed')
  // Cleanup of the failed attempt must not count as an unload.
  await assert.rejects(() => service.startServer(), error => error.code === 'start_failed')
  assert.equal(spawns.length, 2)
  await fake.dispose()
})
