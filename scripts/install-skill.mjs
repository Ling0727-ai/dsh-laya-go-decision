#!/usr/bin/env node
/**
 * Link this repository's `skills/laya-go-decision` into the DSH skills directory.
 *
 * The skill is installed as a link rather than a copy, so editing it here is
 * immediately the installed version and `git pull` updates it. A pre-existing
 * real directory is never replaced, and an existing link is only replaced when
 * it already points at this checkout.
 *
 * Override the destination root with `DSH_SKILLS_DIR`.
 */

import { lstat, mkdir, readlink, rm, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(packageRoot, 'skills', 'laya-go-decision')
const skillsRoot = process.env.DSH_SKILLS_DIR ?? path.join(os.homedir(), '.dsh', 'skills')
const destination = path.join(skillsRoot, 'laya-go-decision')

await mkdir(skillsRoot, { recursive: true })

try {
  const existing = await lstat(destination)
  if (!existing.isSymbolicLink()) {
    throw new Error(`Refusing to replace a non-link skill path: ${destination}`)
  }
  const target = path.resolve(skillsRoot, await readlink(destination))
  if (target !== source) {
    throw new Error(`Refusing to replace a skill link pointing elsewhere: ${destination} -> ${target}`)
  }
  await rm(destination, { recursive: true })
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

await symlink(source, destination, process.platform === 'win32' ? 'junction' : 'dir')
console.log(`Installed laya-go-decision skill: ${destination} -> ${source}`)
