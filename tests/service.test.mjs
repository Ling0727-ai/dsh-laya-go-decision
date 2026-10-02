/**
 * Service tests: question validation, the state-size guard, the uncertainty
 * split, status reporting, and the concurrency cap.
 *
 * Every fake launcher and plugin context is registered with `t.after`, so a
 * failing assertion can never leave a listening socket behind.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { Config, apply, parseQuestions } from '../lib/index.js'
import { answersFor, createFakeContext, startFakeLaya } from './helpers/fakes.mjs'

/**
 * Build a plugin-backed service in external mode against a fake launcher.
 * @param t - test context used for cleanup.
 * @param launcherOptions - fake launcher behaviour.
 * @param overrides - plugin config overrides.
 */
async function serviceFor(t, launcherOptions = {}, overrides = {}) {
  const launcher = await startFakeLaya(launcherOptions)
  t.after(() => launcher.close())
  const fake = createFakeContext()
  t.after(() => fake.dispose())
  apply(fake.ctx, Config({
    mode: 'external',
    baseUrl: launcher.baseUrl,
    autoStart: false,
    ...overrides,
  }))
  return { launcher, fake, service: fake.services.get('layaGoDecision') }
}

/** Build a service pointed at an address where nothing listens. */
function serviceForUrl(t, baseUrl, overrides = {}) {
  const fake = createFakeContext()
  t.after(() => fake.dispose())
  apply(fake.ctx, Config({ mode: 'external', baseUrl, autoStart: false, ...overrides }))
  return { fake, service: fake.services.get('layaGoDecision') }
}

const VALID = [
  { id: 'department', type: 'choice', instructions: 'Which team?', criteria: { billing: 'refunds', technical: 'bugs' } },
  { id: 'urgency', type: 'score', instructions: 'How urgent?', criteria: ['not urgent', 'soon', 'critical'] },
  { id: 'refund', type: 'noul', instructions: 'Is a refund requested?' },
]

test('translates valid questions into the Laya wire shape', () => {
  const wire = parseQuestions(VALID, 16)
  assert.deepEqual(wire, {
    department: { type: 'choice', instructions: 'Which team?', criteria: { billing: 'refunds', technical: 'bugs' } },
    urgency: { type: 'score', instructions: 'How urgent?', criteria: ['not urgent', 'soon', 'critical'] },
    refund: { type: 'noul', instructions: 'Is a refund requested?' },
  })
})

test('rejects unusable questions with named, actionable errors', () => {
  const cases = [
    { questions: [], match: /at least one question/ },
    { questions: [VALID[0], VALID[0]], match: /duplicate question id/ },
    { questions: [{ ...VALID[0], id: '' }], match: /id must be a non-empty string/ },
    { questions: [{ ...VALID[0], type: 'multiple-choice' }], match: /must be choice, score, or noul/ },
    { questions: [{ ...VALID[0], instructions: '   ' }], match: /instructions must be a non-empty string/ },
    { questions: [{ ...VALID[0], criteria: ['billing', 'technical'] }], match: /label-to-description object/ },
    { questions: [{ ...VALID[0], criteria: {} }], match: /at least one label/ },
    { questions: [{ ...VALID[1], criteria: ['only one'] }], match: /at least two levels/ },
    { questions: [{ ...VALID[2], criteria: { yes: 'yes' } }], match: /must be omitted for a noul question/ },
  ]
  for (const { questions, match } of cases) {
    assert.throws(() => parseQuestions(questions, 16), error => {
      assert.equal(error.code, 'invalid_questions')
      assert.match(error.message, match)
      return true
    }, `expected a rejection for ${JSON.stringify(questions)}`)
  }
})

test('caps the question count', () => {
  assert.throws(
    () => parseQuestions([VALID[2], { ...VALID[2], id: 'b' }], 1),
    error => error.code === 'invalid_questions' && /exceed the configured maximum of 1/.test(error.message),
  )
})

test('decide splits certain from uncertain answers', async (t) => {
  const { service } = await serviceFor(t)
  const result = await service.decide('We were billed twice for March.', VALID)
  assert.equal(result.model, 'laya-test')
  assert.deepEqual(result.answers.map(answer => answer.id), ['department', 'urgency', 'refund'])
  assert.equal(result.answers[0].certain, true, '0.87 >= 0.5')
  assert.equal(result.answers[1].certain, false, '0.31 < 0.5')
  assert.equal(result.answers[2].certain, true, 'noul confidence 0.8538 >= 0.5')
  assert.deepEqual([...result.uncertain], ['urgency'])
  assert.equal(result.answers[1].legend['1'], 'soon')
  assert.equal(result.server.adopted, true)
  assert.equal(result.timing.totalMs, 4.49)
  assert.equal(result.usage.inputTokens, 64)
})

test('decide honours a stricter confidence threshold', async (t) => {
  const { service } = await serviceFor(t, {}, { confidenceThreshold: 0.86 })
  const result = await service.decide('state', VALID)
  // department 0.87 stays certain, urgency 0.31 and refund 0.8538 fall below.
  assert.deepEqual([...result.uncertain], ['urgency', 'refund'])
})

test('decide refuses an oversized state instead of letting the model truncate it', async (t) => {
  const { service } = await serviceFor(t, {}, { maxStateChars: 100 })
  await assert.rejects(
    () => service.decide('x'.repeat(101), VALID),
    error => {
      assert.equal(error.code, 'state_too_large')
      assert.match(error.hint, /Summarize/)
      return true
    },
  )
})

test('decide refuses an empty state before contacting the launcher', async (t) => {
  const { service } = await serviceForUrl(t, 'http://127.0.0.1:1')
  await assert.rejects(() => service.decide('   ', VALID), error => error.code === 'invalid_questions')
})

test('decide warns when the launcher omits an answer', async (t) => {
  const { service } = await serviceFor(t, {
    answers: { department: { type: 'choice', choice: 'billing', confidence: 0.9 } },
  })
  const result = await service.decide('state', VALID)
  assert.equal(result.answers.length, 1)
  assert.equal(result.warnings.length, 2)
  assert.match(result.warnings[0], /no answer for "urgency"/)
})

test('decide surfaces a Laya failure as a plugin error', async (t) => {
  const { service } = await serviceFor(t, {
    predictError: { status: 400, code: 'invalid_request', message: 'question options do not fit the head budget' },
  })
  await assert.rejects(
    () => service.decide('state', VALID),
    error => error.code === 'invalid_request' && error.status === 400,
  )
})

test('status reports a reachable launcher with load and counters', async (t) => {
  const { service } = await serviceFor(t)
  const status = await service.status()
  assert.equal(status.reachable, true)
  assert.equal(status.health.engine.loaded, true)
  assert.equal(status.load.phase, 'ready')
  assert.equal(status.metrics.predictTotal, 11)
  // External mode manages no process, so the supervisor reports nothing running.
  assert.equal(status.server.state, 'stopped')
  assert.equal(status.server.owned, false)
})

test('status reports a failed load with its fallback attempts', async (t) => {
  const { service } = await serviceFor(t, {
    load: {
      phase: 'failed',
      error: 'plan deserialize failed',
      attempts: [
        { backend: 'tensorrt', ok: false, error: 'deserialize failed', ms: 40 },
        { backend: 'onnx-cuda', skipped: true, error: 'runtime missing' },
        { backend: 'onnx-cpu', ok: true, ms: 900 },
      ],
    },
  })
  const status = await service.status()
  assert.equal(status.load.phase, 'failed')
  assert.equal(status.load.attempts.filter(attempt => attempt.ok !== true && attempt.skipped !== true).length, 1)
})

test('status never throws for an unreachable launcher', async (t) => {
  const { service } = serviceForUrl(t, 'http://127.0.0.1:1')
  const status = await service.status()
  assert.equal(status.reachable, false)
  assert.equal(status.error.code, 'unreachable')
})

test('predictions respect the concurrency cap', async (t) => {
  let inFlight = 0
  let peak = 0
  const { service } = await serviceFor(t, {
    hook: ({ url, raw, send }) => {
      if (url.pathname !== '/api/v1/predict') return false
      inFlight += 1
      peak = Math.max(peak, inFlight)
      setTimeout(() => {
        inFlight -= 1
        send(200, { model: 'laya-test', answers: answersFor(JSON.parse(raw)), timing: { total_ms: 1 } })
      }, 40)
      return true
    },
  }, { maxConcurrent: 1 })
  await Promise.all([
    service.decide('one', VALID),
    service.decide('two', VALID),
    service.decide('three', VALID),
  ])
  assert.equal(peak, 1)
})
