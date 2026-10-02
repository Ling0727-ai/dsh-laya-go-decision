#!/usr/bin/env node
/**
 * End-to-end smoke test against a real Laya Go Launcher installation.
 *
 * It drives the *plugin's own* code path — `apply` → `ctx.layaGoDecision` → the
 * registered tools → the HTTP client → the supervisor — against a real
 * `layatrt-server.exe`, then terminates the process it started. The only stand-in
 * is the subprocess provider: this script runs outside a DSH process, so it
 * supplies a small `node:child_process` adapter instead of `ctx.subprocess`.
 * Teardown here is therefore best-effort (`taskkill /T /F` on Windows) rather
 * than the Job-object guarantee the mounted provider gives.
 *
 * Usage:
 *   node scripts/smoke.mjs --server C:\laya-go-launcher\layatrt-server.exe [--cwd <dir>]
 *                          [--port <n>] [--state <text>|--file <path>] [--timeout <ms>]
 *
 * Environment fallbacks: LAYA_GO_SMOKE_SERVER, LAYA_GO_SMOKE_CWD.
 */

import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { Config, apply } from '../lib/index.js'
import { createFakeContext } from '../tests/helpers/fakes.mjs'

/** Parse `--flag value` pairs. */
function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (typeof token !== 'string' || !token.startsWith('--')) continue
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) continue
    parsed[token.slice(2)] = value
    index += 1
  }
  return parsed
}

/** Find a free loopback port so the smoke run never fights a running server. */
async function freePort() {
  const probe = createServer()
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
  const { port } = probe.address()
  await new Promise(resolve => probe.close(resolve))
  return port
}

/** Best-effort process-range teardown for the standalone adapter. */
function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    return
  }
  child.kill('SIGTERM')
}

/** A `ctx.subprocess`-shaped adapter over `node:child_process`. */
function nodeSubprocessProvider() {
  return {
    async resolveExecutable(command) {
      return command
    },
    spawn(spec) {
      const child = spawn(spec.argv[0], spec.argv.slice(1), {
        cwd: spec.cwd,
        env: { ...process.env, ...spec.env },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const keep = spec.stdio.stderr.maxBytes
      let stdout = ''
      let stderr = ''
      const tail = (current, chunk) => {
        const next = current + chunk
        return next.length > keep ? next.slice(-keep) : next
      }
      child.stdout?.setEncoding('utf8')
      child.stderr?.setEncoding('utf8')
      child.stdout?.on('data', chunk => { stdout = tail(stdout, String(chunk)) })
      child.stderr?.on('data', chunk => { stderr = tail(stderr, String(chunk)) })
      const done = new Promise((resolveDone, reject) => {
        child.once('error', reject)
        child.once('close', (exitCode, signal) => resolveDone({ exitCode, signal }))
      })
      return {
        stdin: undefined,
        stdout: undefined,
        stderr: undefined,
        control: undefined,
        collected: {
          stdout: { readFrom: () => ({ text: stdout, nextOffset: stdout.length, lossy: false }) },
          stderr: { readFrom: () => ({ text: stderr, nextOffset: stderr.length, lossy: false }) },
        },
        done,
        terminate() {
          killTree(child)
        },
        async waitForExit() {
          await done.catch(() => undefined)
          return true
        },
      }
    },
  }
}

const flags = parseArgs(process.argv.slice(2))
const serverPath = flags.server ?? process.env.LAYA_GO_SMOKE_SERVER
if (serverPath === undefined) {
  console.error('usage: node scripts/smoke.mjs --server <layatrt-server.exe> [--cwd <dir>] [--port <n>] [--state <text>|--file <path>] [--timeout <ms>]')
  process.exit(2)
}
const executable = resolve(serverPath)
const cwd = flags.cwd ?? process.env.LAYA_GO_SMOKE_CWD ?? dirname(executable)
const port = flags.port === undefined ? await freePort() : Number.parseInt(flags.port, 10)
const timeoutMs = flags.timeout === undefined ? 300_000 : Number.parseInt(flags.timeout, 10)
const state = flags.file === undefined
  ? flags.state ?? 'Subject: Duplicate charge on invoice #4411. We were billed twice for March. Please refund the duplicate today.'
  : await readFile(resolve(flags.file), 'utf8')

const fake = createFakeContext({ subprocess: nodeSubprocessProvider() })
apply(fake.ctx, Config({
  mode: 'managed',
  baseUrl: `http://127.0.0.1:${port}`,
  executable,
  serverCwd: cwd,
  args: ['--no-convert'],
  autoStart: false,
  startTimeoutMs: timeoutMs,
  requestTimeoutMs: 30_000,
}))

const decide = fake.tools.get('laya_go_decide')
const status = fake.tools.get('laya_go_status')
const server = fake.tools.get('laya_go_server')
let failed = false

const report = (title, value) => {
  console.log(`\n=== ${title} ===`)
  console.log(value)
}

try {
  report('laya_go_server start', (await server.execute({ action: 'start' }, { signal: undefined })).message)

  const args = {
    state,
    questions: [
      {
        id: 'department',
        type: 'choice',
        instructions: 'Which team should handle this request?',
        criteria: {
          billing: 'invoices, payments, refunds',
          technical: 'bugs, outages, system errors',
          sales: 'pricing, new contracts',
        },
      },
      { id: 'urgency', type: 'score', instructions: 'How urgent is this request?', criteria: ['not urgent', 'soon', 'critical deadline'] },
      { id: 'churn_risk', type: 'noul', instructions: 'Does the user threaten to cancel or leave?' },
    ],
  }
  const value = await decide.execute(args, { signal: undefined })
  report('laya_go_decide', decide.output.render(args, value).map(block => block.text).join('\n'))
  report('canonical value', JSON.stringify(value, null, 2))

  const statusValue = await status.execute({}, { signal: undefined })
  report('laya_go_status', status.output.render({}, statusValue).map(block => block.text).join('\n'))
} catch (error) {
  failed = true
  console.error(`\nsmoke test failed: ${error?.code ?? error?.name}: ${error?.message ?? error}`)
  if (error?.hint !== undefined) console.error(`hint: ${error.hint}`)
} finally {
  const stopped = await server.execute({ action: 'stop' }, { signal: undefined }).catch(error => ({ message: `stop failed: ${error.message}` }))
  console.log(`\n=== laya_go_server stop ===\n${stopped.message}`)
  await fake.dispose()
}

process.exit(failed ? 1 : 0)
