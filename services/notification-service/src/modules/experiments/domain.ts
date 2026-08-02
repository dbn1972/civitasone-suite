/**
 * CR-MKT-05 — email engagement analytics: A/B experiments + click heatmaps.
 *
 * All pure. Allocation is deterministic so the same recipient always lands in
 * the same variant across runs, restarts and workers — a recipient who flipped
 * variants between the send and the follow-up would corrupt the result.
 */
import { createHash } from "node:crypto";

export type VariantDef = {
  id: string;
  key: string;
  /** Whole-percent share of traffic. The set must sum to exactly 100. */
  allocationPct: number;
};

export type AllocationError =
  | { code: "NO_VARIANTS"; message: string }
  | { code: "DUPLICATE_KEY"; message: string }
  | { code: "ALLOCATION_NOT_100"; message: string }
  | { code: "NON_POSITIVE_ALLOCATION"; message: string };

/**
 * Validate a variant set. Returns null when valid, otherwise the first problem.
 * Allocations must be positive whole percents summing to exactly 100 — a
 * remainder would leave recipients silently unassigned.
 */
export function validateVariants(variants: VariantDef[]): AllocationError | null {
  if (variants.length < 2) {
    return { code: "NO_VARIANTS", message: "an experiment needs at least 2 variants" };
  }
  const keys = new Set<string>();
  for (const v of variants) {
    const key = v.key.trim().toLowerCase();
    if (keys.has(key)) {
      return { code: "DUPLICATE_KEY", message: `duplicate variant key "${v.key}"` };
    }
    keys.add(key);
    if (!Number.isInteger(v.allocationPct) || v.allocationPct <= 0) {
      return {
        code: "NON_POSITIVE_ALLOCATION",
        message: `variant "${v.key}" allocation must be a positive whole percent`,
      };
    }
  }
  const total = variants.reduce((sum, v) => sum + v.allocationPct, 0);
  if (total !== 100) {
    return { code: "ALLOCATION_NOT_100", message: `allocations must sum to 100, got ${total}` };
  }
  return null;
}

/**
 * Deterministically assign a subject (recipient id) to a variant.
 *
 * Bucketing: SHA-256(experimentId + ":" + subject) → first 4 bytes → mod 100.
 * Variants are walked in a stable order (sorted by key) and consume contiguous
 * bucket ranges sized by their allocation, so the mapping only changes if the
 * variant set itself changes.
 */
export function allocateVariant(
  experimentId: string, subject: string, variants: VariantDef[],
): VariantDef | null {
  if (variants.length === 0) return null;
  const ordered = [...variants].sort((a, b) => a.key.localeCompare(b.key));
  const bucket = bucketOf(experimentId, subject);
  let cursor = 0;
  for (const v of ordered) {
    cursor += v.allocationPct;
    if (bucket < cursor) return v;
  }
  // Only reachable when allocations sum to < 100; fall back to the last variant
  // rather than dropping the recipient out of the experiment entirely.
  return ordered[ordered.length - 1] ?? null;
}

/** Bucket 0..99 for a subject. Exported so tests can assert stability directly. */
export function bucketOf(experimentId: string, subject: string): number {
  const digest = createHash("sha256").update(`${experimentId}:${subject}`, "utf8").digest();
  return digest.readUInt32BE(0) % 100;
}

export type EngagementEvent = {
  variantId: string;
  eventType: "open" | "click";
  /** 1-based position of the link within the email body; null for opens. */
  linkPosition?: number | null | undefined;
};

export type VariantResult = {
  variantId: string;
  key: string;
  sent: number;
  opens: number;
  clicks: number;
  /** Unit-interval rates, rounded to 4dp. 0 when nothing was sent. */
  openRate: number;
  clickRate: number;
};

export type WinnerVerdict =
  | { decided: false; reason: "insufficient_sample" | "no_separation"; minSamplePerVariant: number }
  | { decided: true; variantId: string; key: string; marginPct: number };

/**
 * Minimum sends per variant before we will name a winner at all. Not a
 * significance calculation — see determineWinner.
 */
export const MIN_SAMPLE_PER_VARIANT = 100;

/** Minimum absolute click-rate gap (percentage points) to call a winner. */
export const MIN_MARGIN_PCT = 2;

export function summariseVariants(
  variants: VariantDef[],
  sentByVariant: Record<string, number>,
  events: EngagementEvent[],
): VariantResult[] {
  return variants.map((v) => {
    const sent = sentByVariant[v.id] ?? 0;
    const opens = events.filter((e) => e.variantId === v.id && e.eventType === "open").length;
    const clicks = events.filter((e) => e.variantId === v.id && e.eventType === "click").length;
    return {
      variantId: v.id,
      key: v.key,
      sent,
      opens,
      clicks,
      openRate: rate(opens, sent),
      clickRate: rate(clicks, sent),
    };
  });
}

function rate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 10_000) / 10_000;
}

/**
 * Winner determination rule — stated explicitly because this is NOT a test of
 * statistical significance:
 *
 *   1. Every variant must have at least MIN_SAMPLE_PER_VARIANT sends. Below
 *      that we return `insufficient_sample` and name no winner.
 *   2. The variant with the highest click rate wins, but only if it leads the
 *      runner-up by at least MIN_MARGIN_PCT percentage points. Otherwise we
 *      return `no_separation`.
 *   3. Ties (identical click rate) are never broken — a coin flip dressed up as
 *      a result is worse than no result.
 *
 * NO p-value, confidence interval or power calculation is computed anywhere in
 * this module. This is a deterministic "clear leader" heuristic. Do not present
 * its output as statistically significant.
 */
export function determineWinner(results: VariantResult[]): WinnerVerdict {
  if (results.length < 2) {
    return { decided: false, reason: "insufficient_sample", minSamplePerVariant: MIN_SAMPLE_PER_VARIANT };
  }
  if (results.some((r) => r.sent < MIN_SAMPLE_PER_VARIANT)) {
    return { decided: false, reason: "insufficient_sample", minSamplePerVariant: MIN_SAMPLE_PER_VARIANT };
  }
  const sorted = [...results].sort((a, b) => b.clickRate - a.clickRate || a.key.localeCompare(b.key));
  const top = sorted[0];
  const second = sorted[1];
  if (!top || !second) {
    return { decided: false, reason: "insufficient_sample", minSamplePerVariant: MIN_SAMPLE_PER_VARIANT };
  }
  const marginPct = Math.round((top.clickRate - second.clickRate) * 10_000) / 100;
  if (marginPct < MIN_MARGIN_PCT) {
    return { decided: false, reason: "no_separation", minSamplePerVariant: MIN_SAMPLE_PER_VARIANT };
  }
  return { decided: true, variantId: top.variantId, key: top.key, marginPct };
}

export type HeatmapCell = { linkPosition: number; clicks: number; sharePct: number };

/**
 * Click heatmap: clicks per link position, ordered by position. `sharePct` is
 * the position's share of all positioned clicks, rounded to 2dp. Clicks with no
 * recorded position are excluded (they carry no positional information).
 */
export function buildHeatmap(events: EngagementEvent[], variantId?: string): HeatmapCell[] {
  const positioned = events.filter((e) =>
    e.eventType === "click" &&
    typeof e.linkPosition === "number" &&
    e.linkPosition > 0 &&
    (variantId === undefined || e.variantId === variantId),
  );
  const total = positioned.length;
  const counts = new Map<number, number>();
  for (const e of positioned) {
    const pos = e.linkPosition as number;
    counts.set(pos, (counts.get(pos) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([linkPosition, clicks]) => ({
      linkPosition,
      clicks,
      sharePct: total > 0 ? Math.round((clicks / total) * 10_000) / 100 : 0,
    }));
}
