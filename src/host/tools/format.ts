/**
 * Formatting helpers shared by the model-facing tools.
 *
 * Renderers receive the tool's canonical JSON value, which has already been
 * validated against the tool schema but is still `JsonValue` at the leaves. These
 * helpers narrow those leaves for display only; they never change the canonical
 * value and never throw.
 *
 * @module dsh-laya-go-decision/host/tools/format
 */

/** Round for display without changing the canonical value. */
export function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** Read one finite number out of an unknown JSON map. */
export function numberOf(source: unknown, key: string | undefined): number | undefined {
  if (key === undefined || typeof source !== 'object' || source === null) return undefined
  const value = (source as Record<string, unknown>)[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Narrow an unknown JSON value to a string-to-string map. */
function stringMap(source: unknown): Record<string, string> | undefined {
  if (typeof source !== 'object' || source === null) return undefined
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    if (typeof value === 'string') result[key] = value
  }
  return Object.keys(result).length === 0 ? undefined : result
}

/** The legend entry a score is closest to, when the launcher reported a legend. */
export function nearestLevel(legend: unknown, score: number): string | undefined {
  const table = stringMap(legend)
  if (table === undefined) return undefined
  const levels = Object.keys(table)
    .map(key => Number.parseInt(key, 10))
    .filter(level => Number.isFinite(level))
  if (levels.length === 0) return undefined
  let best = levels[0]
  if (best === undefined) return undefined
  for (const level of levels) {
    if (Math.abs(level - score) < Math.abs(best - score)) best = level
  }
  return table[String(best)]
}

/** `12 ms` or `4.5 ms`. */
export function millis(value: number | undefined): string | undefined {
  if (value === undefined) return undefined
  return `${round(value, value < 10 ? 2 : 0)} ms`
}
