/**
 * Browser half: the configuration page for this plugin's own Loader row.
 *
 * The Plugins page owns the configuration ledger; a plugin that has settings
 * registers a page for its row and receives the Host-owned values and the write
 * action. This page edits the three fields a deployment is most likely to get
 * wrong — the launcher binary, its working directory, and the API origin — and
 * saves them into the profile's patch layer through `form.mutate`, so the same
 * document a user would edit by hand stays the single source of truth.
 *
 * It is written with `createElement` rather than JSX and imports only `react`
 * (a platform-module seed), which keeps the out-of-tree bundle free of any
 * build-time transform beyond the shared client preset.
 *
 * @module dsh-laya-go-decision/client
 */

import type { Context } from '@deepseek-ai/cordis'
// The `./client` subpath carries the slot declaration this page registers into
// and the props type that comes with it; the renderer's client types declare
// `ctx.slots` itself. Both are type-only, so neither becomes a runtime require.
import type { PluginConfigViewProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createElement as h, useState, type ChangeEvent } from 'react'

/** The key this plugin's row configuration registers under: `<package>#<row id>`. */
export const ROW_CONFIG_KEY = 'dsh-laya-go-decision#laya-go-decision'

/** One atomic write accepted by the row configuration page. */
type ConfigOperation =
  | { readonly op: 'set'; readonly path: readonly string[]; readonly value: string }
  | { readonly op: 'unset'; readonly path: readonly string[] }

/** One editable field of the row configuration. */
interface FieldSpec {
  /** Config key inside the row's `config` object. */
  readonly field: string
  /** Bilingual label. */
  readonly label: string
  /** Bilingual explanation of what the value is and what empty means. */
  readonly hint: string
  /** Example value shown when the field is empty. */
  readonly placeholder: string
}

/** Fields the page edits, in render order. */
const FIELDS: readonly FieldSpec[] = [
  {
    field: 'executable',
    label: '启动器路径 / Launcher path',
    hint: 'layatrt-server.exe 的绝对路径；留空则回退到随插件发布的默认值（PATH 中的 layatrt-server.exe）。保存后会以新路径重启 launcher。',
    placeholder: 'C:\\laya-go-launcher\\layatrt-server.exe',
  },
  {
    field: 'serverCwd',
    label: '工作目录 / Working directory',
    hint: 'launcher 的工作目录，模型目录与 layatrt.config.json 按它解析；留空则使用 DSH 进程目录。',
    placeholder: 'C:\\laya-go-launcher',
  },
  {
    field: 'baseUrl',
    label: '服务地址 / Base URL',
    hint: 'Laya HTTP API 的地址，端口同时用于 --addr；留空回退到 http://127.0.0.1:8420。',
    placeholder: 'http://127.0.0.1:8420',
  },
]

/** Contact-sheet of the styles this small page needs; no stylesheet ships with it. */
const STYLE = {
  wrap: { display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '560px' },
  field: { display: 'flex', flexDirection: 'column', gap: '4px' },
  label: { fontWeight: 600 },
  hint: { opacity: 0.7, fontSize: '0.85em', lineHeight: 1.5 },
  input: {
    padding: '6px 8px',
    border: '1px solid var(--dsh-border, rgba(127, 127, 127, 0.4))',
    borderRadius: '4px',
    background: 'var(--dsh-input-background, transparent)',
    color: 'inherit',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: '0.9em',
  },
  row: { display: 'flex', gap: '8px', alignItems: 'center' },
  button: {
    padding: '5px 12px',
    border: '1px solid var(--dsh-border, rgba(127, 127, 127, 0.4))',
    borderRadius: '4px',
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
  },
  status: { fontSize: '0.85em' },
} as const

/** One editable field, rendered by {@link LayaGoConfigCard}. */
function field(spec: FieldSpec, text: string, disabled: boolean, onChange: (value: string) => void) {
  return h('label', { key: spec.field, style: STYLE.field },
    h('span', { style: STYLE.label }, spec.label),
    h('input', {
      type: 'text',
      style: STYLE.input,
      value: text,
      placeholder: spec.placeholder,
      spellCheck: false,
      disabled,
      onChange: (event: ChangeEvent<HTMLInputElement>) => { onChange(event.target.value) },
    }),
    h('span', { style: STYLE.hint }, spec.hint),
  )
}

/**
 * The one-line summary the Plugins page shows for this row.
 * @param value - the resolved row configuration.
 * @returns the summary text.
 */
export function summarizeConfig(value: Record<string, unknown>): string {
  const executable = typeof value.executable === 'string' && value.executable !== ''
    ? value.executable
    : 'layatrt-server.exe（默认）'
  return `${String(value.mode ?? 'managed')} · ${executable}`
}

/**
 * Render this plugin's row configuration: its one-line summary, or the form.
 * @param props - the view the Plugins page asks for, plus the Host-owned form.
 * @returns the summary line, or the settings form.
 */
export function LayaGoConfigCard(props: PluginConfigViewProps) {
  const form = props.form
  const [draft, setDraft] = useState<Record<string, string> | null>(null)
  const [status, setStatus] = useState<{ kind: 'idle' | 'saved' | 'refused' | 'failed'; detail?: string }>({ kind: 'idle' })
  const value = (form?.state.value ?? {}) as Record<string, unknown>

  /** The accepted value of one field, or the bundle default when unset. */
  const acceptedOf = (fieldName: string): string => {
    const accepted = value[fieldName]
    return typeof accepted === 'string' ? accepted : ''
  }
  /** What the input shows: the user's draft, else the accepted value. */
  const shownOf = (fieldName: string): string => draft?.[fieldName] ?? acceptedOf(fieldName)

  if (props.view === 'summary') {
    return h('span', null, summarizeConfig(value))
  }

  const writable = form !== undefined && form.state.writable && form.state.mode === 'host'
  const statusText = status.kind === 'saved'
    ? '已保存 / saved'
    : status.kind === 'refused'
      ? 'Host 拒绝了这次修改 / the Host refused the change'
      : status.kind === 'failed'
        ? `保存失败 / save failed: ${status.detail ?? 'unknown error'}`
        : undefined

  const save = async (): Promise<void> => {
    if (form === undefined) return
    const ops: ConfigOperation[] = []
    const next = (fieldName: string): string => shownOf(fieldName).trim()
    for (const spec of FIELDS) {
      const wanted = next(spec.field)
      if (wanted === acceptedOf(spec.field)) continue
      if (wanted === '') ops.push({ op: 'unset', path: [spec.field] })
      else ops.push({ op: 'set', path: [spec.field], value: wanted })
    }
    if (ops.length === 0) {
      setStatus({ kind: 'saved', detail: 'no changes' })
      return
    }
    try {
      const accepted = await form.mutate(ops, form.state.revision)
      setStatus(accepted ? { kind: 'saved' } : { kind: 'refused' })
    } catch (error) {
      setStatus({ kind: 'failed', detail: error instanceof Error ? error.message : String(error) })
    }
  }

  const reset = async (): Promise<void> => {
    if (form === undefined) return
    setDraft(null)
    try {
      const accepted = await form.mutate(
        FIELDS.map(spec => ({ op: 'unset' as const, path: [spec.field] })),
        form.state.revision,
      )
      setStatus(accepted ? { kind: 'saved' } : { kind: 'refused' })
    } catch (error) {
      setStatus({ kind: 'failed', detail: error instanceof Error ? error.message : String(error) })
    }
  }

  if (form === undefined || form.state.status === 'loading') {
    return h('div', { style: STYLE.wrap }, h('span', { style: STYLE.hint }, '正在读取配置… / loading configuration…'))
  }
  if (form.state.status === 'unavailable') {
    return h('div', { style: STYLE.wrap }, h('span', { style: STYLE.hint },
      '当前连接不提供可写的 profile 配置（memory 模式）/ this connection keeps preferences process-local, so the row configuration cannot be edited here.'))
  }

  return h('div', { style: STYLE.wrap },
    ...FIELDS.map(spec => field(
      spec,
      shownOf(spec.field),
      !writable,
      (text: string) => { setDraft(current => ({ ...current, [spec.field]: text })) },
    )),
    h('div', { style: STYLE.row },
      h('button', { type: 'button', style: STYLE.button, disabled: !writable, onClick: () => { void save() } },
        '保存 / Save'),
      h('button', { type: 'button', style: STYLE.button, disabled: !writable, onClick: () => { void reset() } },
        '恢复默认 / Reset to defaults'),
      statusText === undefined ? null : h('span', { style: STYLE.status }, statusText),
    ),
    h('span', { style: STYLE.hint },
      '保存写入 profile 的 cordis.patch.yml，并重新加载这个插件行；正在运行的 launcher 会用新配置重启（不会残留旧进程）。'),
  )
}

/** Services this half needs: the slot registry its page registers into. */
export const inject = ['slots']

/**
 * Register the row configuration page.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
      name: 'plugins.row.config',
      key: ROW_CONFIG_KEY,
    }, LayaGoConfigCard)),
    'laya-go-decision: row configuration page',
  )
}
