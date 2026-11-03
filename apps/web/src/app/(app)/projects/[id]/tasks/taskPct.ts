/**
 * project-service returns task percentages as Postgres NUMERIC, i.e. decimal
 * strings ("30.00"), not JSON numbers. The page called `weightPct.toFixed(1)` on
 * that string and crashed the whole /projects/[id]/tasks render (UAT L1,
 * Phase 1B). These coerce defensively; a value that is not a finite number is
 * null so the page shows "—" rather than a fabricated 0.
 */
export function toPct(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** "30.0%" for a weight, "—" when the backend gave nothing usable. */
export function formatWeightPct(value: unknown): string {
  const n = toPct(value);
  return n === null ? "—" : `${n.toFixed(1)}%`;
}
