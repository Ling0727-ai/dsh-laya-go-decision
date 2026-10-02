/**
 * Structural tests for the plugin entry: the exported surface DSH loads, the
 * configuration defaults, and the tools `apply` registers.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { Config, apply, inject, name } from '../lib/index.js'
import { createFakeContext, startFakeLaya } from './helpers/fakes.mjs'

test('exports the DSH plugin surface', () => {
  assert.equal(name, 'laya-go-decision')
  assert.deepEqual(inject, ['tools'])
  assert.equal(typeof apply, 'function')
  assert.equal(typeof Config, 'function')
})

test('config schema carries the documented defaults', () => {
  const config = Config({})
  assert.equal(config.mode, 'managed')
  assert.equal(config.baseUrl, 'http://127.0.0.1:8420')
  assert.equal(config.executable, 'layatrt-server.exe')
  assert.deepEqual(config.args, [])
  assert.equal(config.autoStart, true)
  assert.equal(config.startTimeoutMs, 180_000)
  assert.equal(config.requestTimeoutMs, 15_000)
  assert.equal(config.maxConcurrent, 2)
  assert.equal(config.maxQuestions, 16)
  assert.equal(config.maxStateChars, 20_000)
  assert.equal(config.confidenceThreshold, 0.5)
  assert.equal(config.logBytes, 16_384)
})

test('config schema rejects an unknown mode', () => {
  assert.throws(() => Config({ mode: 'sometimes' }))
})

test('apply provides ctx.layaGoDecision and registers three tools', () => {
  const fake = createFakeContext()
  apply(fake.ctx, Config({}))
  assert.deepEqual([...fake.tools.keys()].sort(), ['laya_go_decide', 'laya_go_server', 'laya_go_status'])
  const service = fake.services.get('layaGoDecision')
  assert.ok(service, 'the service is registered under its context key')
  assert.equal(service.name, 'layaGoDecision')
  assert.equal(typeof service.decide, 'function')
  assert.equal(fake.effects.length, 1, 'the launcher teardown is registered as an effect')
})

test('the tools are pure declarations until executed', () => {
  const fake = createFakeContext()
  apply(fake.ctx, Config({}))
  for (const definition of fake.tools.values()) {
    assert.equal(typeof definition.description, 'string')
    assert.equal(typeof definition.parameters, 'object')
    assert.equal(typeof definition.execute, 'function')
    assert.equal(typeof definition.output.render, 'function')
  }
})

test('unloading the plugin disposes the runtime without a subprocess provider', async () => {
  const fake = createFakeContext()
  apply(fake.ctx, Config({ mode: 'external' }))
  await fake.dispose()
})

test('laya_go_decide executes through the tool registry against a launcher', async (t) => {
  const launcher = await startFakeLaya()
  t.after(() => launcher.close())
  const fake = createFakeContext()
  apply(fake.ctx, Config({ mode: 'external', baseUrl: launcher.baseUrl, autoStart: false }))
  const decide = fake.tools.get('laya_go_decide')
  const args = {
    state: 'We were billed twice for March.',
    questions: [
      { id: 'department', type: 'choice', instructions: 'Which team?', criteria: { billing: 'refunds', technical: 'bugs' } },
      { id: 'urgency', type: 'score', instructions: 'How urgent?', criteria: ['not urgent', 'soon', 'critical'] },
      { id: 'refund', type: 'noul', instructions: 'Is a refund requested?' },
    ],
  }
  const value = await decide.execute(args, { signal: undefined })
  assert.equal(value.model, 'laya-test')
  assert.deepEqual(value.answers.map(answer => answer.id), ['department', 'urgency', 'refund'])
  assert.equal(value.answers[0].choice, 'billing')
  assert.equal(value.answers[0].certain, true)
  assert.equal(value.answers[1].certain, false)
  assert.deepEqual([...value.uncertain], ['urgency'])
  assert.equal(value.server.mode, 'external')
  assert.equal(value.server.adopted, true)
  assert.deepEqual([...value.warnings], [])

  const text = decide.output.render(args, value).map(block => block.text).join('\n')
  assert.match(text, /department: choice "billing"/)
  assert.match(text, /UNCERTAIN/)
  assert.match(text, /Uncertain answers/)
  // A noul answer names its direction: `certain` grades sharpness, not "yes".
  assert.match(text, /refund: noul=0\.8538, most likely "yes" \(confidence 0\.854, certain\)/)

  // One request carried all three questions: that is the point of the tool.
  const predictions = launcher.requests.filter(request => request.path === '/api/v1/predict')
  assert.equal(predictions.length, 1)
  const body = JSON.parse(predictions[0].raw)
  assert.deepEqual(Object.keys(body.questions), ['department', 'urgency', 'refund'])
})

test('laya_go_decide rejects arguments the schema cannot accept', async () => {
  const fake = createFakeContext()
  apply(fake.ctx, Config({ mode: 'external' }))
  const decide = fake.tools.get('laya_go_decide')
  await assert.rejects(() => decide.execute({ questions: [] }, { signal: undefined }))
  await assert.rejects(() => decide.execute({ state: 'x', questions: [{ id: 'a', type: 'nope', instructions: 'y' }] }, { signal: undefined }))
})

test('laya_go_status reports an unreachable launcher instead of failing', async () => {
  const fake = createFakeContext()
  apply(fake.ctx, Config({ mode: 'external', baseUrl: 'http://127.0.0.1:1' }))
  const status = fake.tools.get('laya_go_status')
  const value = await status.execute({}, { signal: undefined })
  assert.equal(value.reachable, false)
  assert.equal(value.error.code, 'unreachable')
  assert.equal(value.mode, 'external')
  const text = status.output.render({}, value).map(block => block.text).join('\n')
  assert.match(text, /not answering/)
})

test('laya_go_server refuses to stop a launcher it does not own', async (t) => {
  const launcher = await startFakeLaya()
  t.after(() => launcher.close())
  const fake = createFakeContext()
  apply(fake.ctx, Config({ mode: 'external', baseUrl: launcher.baseUrl }))
  const server = fake.tools.get('laya_go_server')
  await assert.rejects(
    () => server.execute({ action: 'stop' }, { signal: undefined }),
    error => error.code === 'server_not_managed',
  )
})
