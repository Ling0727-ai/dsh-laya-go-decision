/**
 * Client (browser) bundle for a plugin that lives outside the Harness workspace.
 *
 * The shared preset in `packages/client/tsdown.client.ts` locates a package's
 * manifest by name under the harness workspace, so this script publishes our
 * `package.json` into a throwaway workspace directory for the duration of the
 * build and removes it afterwards. Everything else — the module-loader factory
 * format, externals, CSS handling — comes from that preset.
 */

import { copyFile, mkdir, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const harnessRoot = resolve(projectRoot, '..', '..', 'deepseek-harness')
const manifestDirectory = join(harnessRoot, 'packages', 'client', `laya-go-decision-external-build-${process.pid}`)
const configPath = join(projectRoot, 'tsdown.config.ts')

await mkdir(manifestDirectory, { recursive: true })
await copyFile(join(projectRoot, 'package.json'), join(manifestDirectory, 'package.json'))

try {
  const command = process.platform === 'win32' ? 'pnpm.exe' : 'pnpm'
  const result = spawnSync(
    command,
    ['--dir', harnessRoot, 'exec', 'tsdown', '--config', configPath],
    { cwd: projectRoot, stdio: 'inherit' },
  )
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) process.exitCode = result.status ?? 1
} finally {
  await rm(manifestDirectory, { recursive: true, force: true })
}
