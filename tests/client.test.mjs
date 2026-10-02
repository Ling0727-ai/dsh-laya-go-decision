/**
 * Client tests against real loopback sockets: parsing, error mapping, deadlines,
 * cancellation, and the reachability probe.
 *
 * Each fake server is registered with `t.after`, so a failing assertion cannot
 * leave a listening socket behind and stall the test process.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { LayaClient, LayaGoError } from '../lib/index.js'
import { startFakeLaya, startForeignServer } from './helpers/fakes.mjs'

/** Build a client pointed at one fake launcher. */
function clientFor(baseUrl, overrides = {}) {
  return new LayaClient({
    apiBaseUrl: `${baseUrl}/api/v1`,
    requestTimeoutMs: 5000,
    probeTimeoutMs: 500,
    ...overrides,
  })
}

test('reads health, load state, metrics, and predictions', async (t) => {
  const launcher = await startFakeLaya()
  t.after(() => launcher.close())
  const client = clientFor(launcher.baseUrl)
  const health = await client.health()
  assert.equal(health.status, 'ok')
  assert.equal(health.engine.loaded, true)
  assert.equal(health.backend.selected, 'tensorrt')
  assert.equal(health.device.vramTotalMb, 12288)
  const load = await client.loadState()
  assert.equal(load.phase, 'ready')
  assert.equal(load.attempts.length, 1)
  const metrics = await client.metrics()
  assert.equal(metrics.predictTotal, 11)
  assert.equal(metrics.latency.p99, 9.1)
  const prediction = await client.predict({
    state: 'hello',
    questions: { intent: { type: 'noul', instructions: 'Is this a greeting?' } },
  })
  assert.equal(prediction.model, 'laya-test')
  assert.equal(prediction.answers.intent.noul, 0.8538)
  assert.equal(prediction.timing.totalMs, 4.49)
})

test('probe classifies a launcher, an empty port, and a foreign service', async (t) => {
  const launcher = await startFakeLaya()
  t.after(() => launcher.close())
  const foreign = await startForeignServer()
  t.after(() => foreign.close())
  assert.equal((await clientFor(launcher.baseUrl).probe()).kind, 'laya')
  assert.equal((await clientFor('http://127.0.0.1:1').probe()).kind, 'absent')
  assert.equal((await clientFor(foreign.baseUrl).probe()).kind, 'foreign')
})

test('maps a Laya error body onto a plugin error, keeping the code', async (t) => {
  const launcher = await startFakeLaya({
    predictError: { status: 409, code: 'engine_not_loaded', message: 'load a model before predicting' },
  })
  t.after(() => launcher.close())
  await assert.rejects(
    () => clientFor(launcher.baseUrl).predict({ state: 'x', questions: { a: { type: 'noul', instructions: 'y?' } } }),
    error => {
      assert.ok(error instanceof LayaGoError)
      assert.equal(error.code, 'engine_not_loaded')
      assert.equal(error.status, 409)
      assert.equal(error.detail, 'engine_not_loaded')
      assert.match(error.message, /load a model before predicting/)
      assert.match(error.hint, /laya_go_server/)
      // DSH renders only `message` for a thrown tool failure, so the recovery
      // step has to be part of it.
      assert.match(error.message, /laya_go_server/)
      assert.match(error.describe(), /laya_go_server/)
      return true
    },
  )
})

test('maps an unknown Laya error code to http_error', async (t) => {
  const launcher = await startFakeLaya({
    predictError: { status: 500, code: 'something_new', message: 'boom' },
  })
  t.after(() => launcher.close())
  await assert.rejects(
    () => clientFor(launcher.baseUrl).predict({ state: 'x', questions: { a: { type: 'noul', instructions: 'y?' } } }),
    error => error.code === 'http_error' && error.status === 500,
  )
})

test('reports unreachable when nothing listens', async () => {
  await assert.rejects(() => clientFor('http://127.0.0.1:1').health(), error => error.code === 'unreachable')
})

test('reports timeout when the launcher does not answer in time', async (t) => {
  const launcher = await startFakeLaya({ delayMs: 500 })
  t.after(() => launcher.close())
  await assert.rejects(
    () => clientFor(launcher.baseUrl, { requestTimeoutMs: 100 }).health(),
    error => error.code === 'timeout',
  )
})

test('reports aborted when the caller cancels, not timeout', async (t) => {
  const launcher = await startFakeLaya({ delayMs: 2000 })
  t.after(() => launcher.close())
  const controller = new AbortController()
  const pending = clientFor(launcher.baseUrl, { requestTimeoutMs: 10_000 }).health({ signal: controller.signal })
  controller.abort()
  await assert.rejects(() => pending, error => error.code === 'aborted')
})

test('reports bad_response for a body that is not JSON', async (t) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' })
    response.end('not json at all')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  await assert.rejects(
    () => clientFor(`http://127.0.0.1:${server.address().port}`).health(),
    error => error.code === 'bad_response',
  )
})

test('reports bad_response for JSON that is not a Laya health payload', async (t) => {
  const foreign = await startForeignServer()
  t.after(() => foreign.close())
  await assert.rejects(
    () => clientFor(foreign.baseUrl).health(),
    error => error.code === 'bad_response' && /without a Laya status field/.test(error.message),
  )
})

test('sends the admin bearer token only when asked', async (t) => {
  const seen = []
  const launcher = await startFakeLaya({
    hook: ({ request, send }) => {
      seen.push({ path: request.url, authorization: request.headers.authorization })
      send(200, { config: {} })
      return true
    },
  })
  t.after(() => launcher.close())
  const client = clientFor(launcher.baseUrl, { adminToken: 'secret-token' })
  await client.serverConfig()
  await client.serverConfig({ admin: true })
  assert.equal(seen.length, 2)
  assert.equal(seen[0].authorization, undefined)
  assert.equal(seen[1].authorization, 'Bearer secret-token')
})
