// GAP-PROJECTS-UTILIZATION-02/03: derive the fund-utilization summary tiles
// from the rows (BigInt, minor units) instead of hand-typed strings that only
// matched by coincidence, and compute "Utilization %" as the WEIGHTED ratio
// sum(utilised)/sum(allocated) — the figure the "% of allocated" label claims
// — not the unweighted mean of per-row percentages the old static page showed.
import type { UtilizationRow } from "./UtilizationTable";

export type UtilizationTotals = {
  allocatedMinor: bigint;
  releasedMinor: bigint;
  utilisedMinor: bigint;
  /** allocated - utilised, computed (never hand-typed) */
  unspentMinor: bigint;
  /** utilised / allocated as a percent (0-100, one-decimal rounded), or null
   * when there is no positive allocation to divide by. */
  utilisationPct: number | null;
};

function toMinor(v: string | null | undefined): bigint {
  if (v === null || v === undefined || v === "") return 0n;
  const t = v.trim();
  if (!/^-?\d+$/.test(t)) return 0n;
  return BigInt(t);
}

export function deriveUtilizationTotals(rows: readonly UtilizationRow[]): UtilizationTotals {
  let allocatedMinor = 0n;
  let releasedMinor = 0n;
  let utilisedMinor = 0n;
  for (const r of rows) {
    allocatedMinor += toMinor(r.allocatedMinor);
    releasedMinor += toMinor(r.releasedMinor);
    utilisedMinor += toMinor(r.utilisedMinor);
  }
  const unspentMinor = allocatedMinor - utilisedMinor;
  const utilisationPct =
    allocatedMinor > 0n
      ? Number((utilisedMinor * 1000n + allocatedMinor / 2n) / allocatedMinor) / 10
      : null;
  return { allocatedMinor, releasedMinor, utilisedMinor, unspentMinor, utilisationPct };
}
