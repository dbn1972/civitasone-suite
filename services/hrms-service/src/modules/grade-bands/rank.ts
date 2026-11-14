/**
 * S8-G4 -- the one place that turns "a designation" into "a rank" for consumers that used to read `level`.
 *
 * Government tenants (pay_scale.kind = 'cpc7', the default): rank == the designation's 7th CPC level
 * (1-18; 0 / out of range = unclassified = null). Identical to what every consumer did before.
 * Band tenants (pay_scale.kind = 'private_bands'): rank == the rank of the band the designation points to;
 * a designation with no band is unclassified (null) -- we never guess a rank from a stale `level`.
 *
 * Pure functions, no I/O, so the parity between the two modes is unit-testable.
 */
import type { PayScaleKind } from "../policy-settings/registry.js";

export interface BandRef { id: string; code: string; name: string; rank: number }

export interface EffectiveRank {
  scale: PayScaleKind;
  /** The rank consumers compare. null == unclassified (unknown: never wrongly deny anyone). */
  rank: number | null;
  /** Where `rank` came from. */
  source: "level" | "band" | null;
  /** The designation's CPC level, validated 1-18, regardless of scale (deputation / pay matrix still use it). */
  payLevel: number | null;
  band: BandRef | null;
}

export function normaliseCpcLevel(level: number | null | undefined): number | null {
  return typeof level === "number" && Number.isInteger(level) && level >= 1 && level <= 18 ? level : null;
}

export function effectiveRank(scale: PayScaleKind, level: number | null | undefined, band: BandRef | null | undefined): EffectiveRank {
  const payLevel = normaliseCpcLevel(level);
  if (scale === "private_bands") {
    const b = band ?? null;
    return { scale, rank: b ? b.rank : null, source: b ? "band" : null, payLevel, band: b };
  }
  return { scale: "cpc7", rank: payLevel, source: payLevel === null ? null : "level", payLevel, band: null };
}
