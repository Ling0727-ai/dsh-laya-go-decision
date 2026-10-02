/**
 * Test doubles for the Laya HTTP API and for the Cordis pieces the plugin uses.
 *
 * The fake launcher is a real `node:http` server on an ephemeral port, so the
 * plugin's client, readiness polling, and error mapping all run against genuine
 * sockets instead of a stubbed `fetch`.
 */

import { createServer } from 'node:http'

/** Default health payload, shaped like `GET /api/v1/health`. */
export function healthPayload(overrides = {}) {
  return {
    status: 'ok',
    version: '0.1.0',
    kernel: { available: true, tensorrt: '101600' },
    backend: {
      requested: 'auto',
      selected: 'tensorrt',
      note: 'auto prefers TensorRT; an .onnx model is served by ONNX Runtime',
      onnx: { available: true, version: '1.25.0', error: '' },
    },
    device: { name: 'Test GPU', compute_capability: '12.0', vram_free_mb: 8192, vram_total_mb: 12288 },
    engine: { loaded: true, path: 'C:\\models\\laya_e2e.engine', backend: 'TensorRT', contexts: 2 },
    ...overrides,
  }
}

/** Default load payload, shaped like `GET /api/v1/load`. */
export function loadPayload(overrides = {}) {
  return {
    phase: 'ready',
    mode: 'auto',
    path: 'C:\\models\\laya_e2e.engine',
    backend: 'TensorRT',
    device: 'Test GPU',
    attempts: [{ backend: 'tensorrt', ok: true, ms: 812.5 }],
    started_at: '2026-10-02T03:00:00Z',
    ended_at: '2026-10-02T03:00:01Z',
    ...overrides,
  }
}

/** Default metrics payload, shaped like `GET /api/v1/metrics`. */
export function metricsPayload(overrides = {}) {
  return {
    requests_total: 12,
    requests_failed: 1,
    predict_total: 11,
    latency_ms: { p50: 4.49, p90: 6.29, p99: 9.1, min: 2.36, max: 14.2 },
    ...overrides,
  }
}

/** Build one answer per question in the request body. */
export function answersFor(body) {
  const answers = {}
  for (const [id, question] of Object.entries(body.questions ?? {})) {
    if (question.type === 'choice') {
      const labels = Object.keys(question.criteria ?? {})
      const choice = labels[0] ?? 'unknown'
      const probabilities = {}
      for (const [index, label] of labels.entries()) probabilities[label] = index === 0 ? 0.9 : 0.1 / Math.max(1, labels.length - 1)
      answers[id] = { type: 'choice', choice, probabilities, confidence: 0.87, action: { act_probability: 1 } }
      continue
    }
    if (question.type === 'score') {
      const legend = {}
      for (const [index, level] of (question.criteria ?? []).entries()) legend[String(index)] = level
      answers[id] = {
        type: 'score',
        score: 1.25,
        legend,
        probabilities: { 0: 0.2, 1: 0.6, 2: 0.2 },
        confidence: 0.31,
        action: { act_probability: 0.83 },
      }
      continue
    }
    answers[id] = { type: 'noul', noul: 0.8538, confidence: 0.8538, action: { act_probability: 1 } }
  }
  return answers
}

/**
 * Start a fake Laya launcher.
 * @param options - payload overrides, an optional fixed port, and an optional raw request hook.
 * @returns the running server, its recorded requests, and a stop function.
 */
export async function startFakeLaya(options = {}) {
  const requests = []
  const server = createServer((request, response) => {
    const chunks = []
    request.on('data', chunk => chunks.push(chunk))
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      requests.push({ method: request.method, path: url.pathname, raw })
      const send = (status, body, contentType = 'application/json') => {
        response.writeHead(status, { 'content-type': contentType })
        response.end(typeof body === 'string' ? body : JSON.stringify(body))
      }
      if (options.hook !== undefined && options.hook({ request, url, raw, send }) === true) return
      if (options.delayMs !== undefined) {
        setTimeout(() => route(url.pathname, raw, send), options.delayMs)
        return
      }
      route(url.pathname, raw, send)
    })
  })

  function route(path, raw, send) {
    const health = typeof options.health === 'function' ? options.health() : healthPayload(options.health)
    const load = typeof options.load === 'function' ? options.load() : loadPayload(options.load)
    switch (path) {
      case '/api/v1/health':
        send(options.healthStatus ?? 200, health)
        return
      case '/api/v1/load':
        send(200, load)
        return
      case '/api/v1/metrics':
        send(200, metricsPayload(options.metrics))
        return
      case '/api/v1/predict': {
        if (options.predictError !== undefined) {
          send(options.predictError.status, { error: options.predictError })
          return
        }
        const body = raw === '' ? {} : JSON.parse(raw)
        send(200, {
          model: 'laya-test',
          answers: options.answers ?? answersFor(body),
          usage: { input_tokens: 64, output_tokens: 0 },
          timing: { total_ms: 4.49, tokenize_ms: 0.21, inference_ms: 4.1 },
        })
        return
      }
      default:
        send(404, { error: { code: 'not_found', message: `no route for ${path}` } })
    }
  }

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`
  return {
    baseUrl,
    apiBaseUrl: `${baseUrl}/api/v1`,
    port: address.port,
    requests,
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

/**
 * Find a currently free loopback port, so a managed start can be given a real
 * address before any process exists.
 * @returns the port number.
 */
export async function reservePort() {
  const probe = createServer()
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
  const address = probe.address()
  await new Promise(resolve => probe.close(resolve))
  return address.port
}

/** Start a plain HTTP server that is not Laya, to test port-occupancy handling. */
export async function startForeignServer(payload = { hello: 'world' }) {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(payload))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

/**
 * Minimal Cordis-shaped context: records tool registrations and provided
 * services, and hands out `ctx.get` results the test seeds.
 */
export function createFakeContext({ subprocess } = {}) {
  const tools = new Map()
  const services = new Map()
  const effects = []
  const logs = []
  if (subprocess !== undefined) services.set('subprocess', subprocess)
  const ctx = {
    logger: {
      info: message => logs.push(['info', message]),
      warn: message => logs.push(['warn', message]),
      error: message => logs.push(['error', message]),
    },
    tools: {
      register(definition) {
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      },
    },
    get: name => services.get(name),
    reflect: {
      provide(name, value) {
        services.set(name, value)
      },
    },
    effect(callback) {
      const disposer = callback()
      effects.push(disposer)
      return () => {}
    },
  }
  return {
    ctx,
    tools,
    services,
    logs,
    effects,
    /** Run every disposer the plugin registered, newest first. */
    dispose: async () => {
      for (const disposer of [...effects].reverse()) {
        if (typeof disposer === 'function') await disposer()
      }
    },
  }
}

/**
 * A Cordis-shaped `ctx.subprocess` whose spawn starts a real fake launcher.
 *
 * The fake launcher binds the address the supervisor passed as `--addr`, so a
 * managed start is exercised end to end: argv derivation, listening, readiness
 * polling, and termination.
 * @param options - launcher behaviour handed to {@link startFakeLaya}.
 * @returns the fake service plus the spawn records it produced.
 */
export function createFakeSubprocess(options = {}) {
  const spawns = []
  const resolved = []
  const service = {
    async resolveExecutable(command) {
      if (options.executableMissing === true) throw new Error(`ENOENT: ${command}`)
      resolved.push(command)
      return command
    },
    spawn(spec) {
      let resolveDone
      const done = new Promise(resolve => { resolveDone = resolve })
      const state = { closed: false, terminated: 0 }
      let launcher
      const close = async (exitCode = options.exitCode ?? 0) => {
        if (state.closed) return
        state.closed = true
        if (launcher !== undefined) {
          const started = await launcher
          await started.close()
        }
        resolveDone({ exitCode, signal: null })
      }
      const handle = {
        stdin: undefined,
        stdout: undefined,
        stderr: undefined,
        control: undefined,
        collected: {
          stderr: {
            readFrom: () => ({ text: options.stderrText ?? '', nextOffset: 0, lossy: false }),
          },
        },
        done,
        terminate() {
          state.terminated += 1
          void close()
        },
        async waitForExit() {
          await close()
          return true
        },
      }
      spawns.push({ spec, handle, state, close })
      if (options.exitImmediately === true) {
        queueMicrotask(() => { void close() })
        return handle
      }
      const addr = addressFromArgv(spec.argv)
      const launcherOptions = typeof options.launcher === 'function' ? options.launcher() : options.launcher ?? {}
      launcher = startFakeLaya({ ...launcherOptions, ...addr === undefined ? {} : { port: addr.port } })
      void launcher.then(started => {
        if (state.closed) void started.close()
      }, () => { void close(1) })
      return handle
    },
  }
  return { service, spawns, resolved }
}

/** Read the port out of a `--addr host:port` entry in a spawn argv. */
function addressFromArgv(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--addr' || argument === '-addr') {
      const value = argv[index + 1]
      if (value === undefined) return undefined
      const port = Number.parseInt(value.slice(value.lastIndexOf(':') + 1), 10)
      return Number.isFinite(port) ? { port } : undefined
    }
    if (typeof argument === 'string' && (argument.startsWith('--addr=') || argument.startsWith('-addr='))) {
      const value = argument.slice(argument.indexOf('=') + 1)
      const port = Number.parseInt(value.slice(value.lastIndexOf(':') + 1), 10)
      return Number.isFinite(port) ? { port } : undefined
    }
  }
  return undefined
}
