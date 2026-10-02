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
export declare function round(value: number, digits: number): number;
/** Read one finite number out of an unknown JSON map. */
export declare function numberOf(source: unknown, key: string | undefined): number | undefined;
/** The legend entry a score is closest to, when the launcher reported a legend. */
export declare function nearestLevel(legend: unknown, score: number): string | undefined;
/** `12 ms` or `4.5 ms`. */
export declare function millis(value: number | undefined): string | undefined;
//# sourceMappingURL=format.d.ts.map