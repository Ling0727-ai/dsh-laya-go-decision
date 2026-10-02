/**
 * The built browser half must satisfy the client module system's contract: a
 * `window.__ModuleLoader__.load({ id, factory })` registration whose factory
 * answers from the injected `require` and exports a Cordis client plugin.
 *
 * The bundle is loaded here with a shimmed `window` and Node's own `require`, so
 * the artifact itself — not the TypeScript source — is what gets asserted. Node
 * caches the module, so the shim is installed once and its registration shared.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const require = createRequire(import.meta.url)

/** The registration the bundle performed, captured from a shimmed loader. */
const registration = {}
{
  const previousWindow = globalThis.window
  globalThis.window = { __ModuleLoader__: { load: entry => { Object.assign(registration, entry) } } }
  try {
    require('../lib/client.js')
  } finally {
    globalThis.window = previousWindow
  }
}

/** Read the emitted artifact. */
function bundleSource() {
  return readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
}

test('the browser bundle registers a module-loader factory under the package name', () => {
  assert.equal(registration.id, 'dsh-laya-go-decision')
  assert.equal(typeof registration.factory, 'function')
})

test('the factory exports a client plugin that registers the row configuration page', () => {
  const plugin = registration.factory(require)
  assert.equal(typeof plugin.apply, 'function')
  assert.deepEqual([...plugin.inject], ['slots'])

  const registrations = []
  const effects = []
  const ctx = {
    slots: {
      inject(name, callback) {
        assert.equal(name, 'plugins.row.config')
        callback()
        return () => {}
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
    effect(callback, label) {
      effects.push(label)
      callback()
      return () => {}
    },
  }
  plugin.apply(ctx)
  assert.equal(registrations.length, 1)
  // The Plugins page keys a row's configuration page as `<package>#<row id>`.
  assert.deepEqual(registrations[0].options, {
    name: 'plugins.row.config',
    key: 'dsh-laya-go-decision#laya-go-decision',
  })
  assert.equal(typeof registrations[0].component, 'function')
  assert.deepEqual(effects, ['laya-go-decision: row configuration page'])
})

test('the artifact still carries the page copy and the key the page is looked up by', () => {
  const source = bundleSource()
  assert.match(source, /layatrt-server\.exe（默认）/)
  assert.match(source, /plugins\.row\.config/)
  assert.match(source, /dsh-laya-go-decision#laya-go-decision/)
  assert.match(source, /启动器路径 \/ Launcher path/)
})

test('the bundle requires nothing but platform modules', () => {
  const required = [...bundleSource().matchAll(/require\((["'])([^"']+)\1\)/g)].map(match => match[2])
  const external = [...new Set(required)].filter(specifier => specifier !== 'react' && specifier !== 'react/jsx-runtime')
  assert.deepEqual(external, [], `unexpected runtime requires: ${external.join(', ')}`)
})
