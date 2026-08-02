/**
 * matrix/domain.ts — Pure validation for cross-sell matrix entries.
 *
 * A matrix entry says "when a customer owns product A, recommend product B",
 * optionally narrowed to a segment and/or a delivery channel.
 */

export interface MatrixScope {
  /** Optional customer segment the rule applies to. */
  segment?: string | null;
  /** Optional delivery channel the rule applies to. */
  channel?: string | null;
}

export interface MatrixKey extends MatrixScope {
  triggerProductId: string;
  recommendedProductId: string;
}

export interface MatrixEntryInput extends MatrixKey {
  priority: number;
}

/** Longest accepted segment/channel value — matches varchar(64) in the schema. */
export const MAX_SCOPE_LENGTH = 64;

/**
 * Normalise an optional scope value so null, undefined and "" all collapse to
 * the same key, and comparison is case/whitespace insensitive.
 */
export function normaliseScopeValue(value?: string | null): string {
  if (value === undefined || value === null) return "";
  return value.trim().toLowerCase();
}

function validateScopeValue(label: string, value?: string | null): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return `${label} must be a string`;
  if (value.trim().length === 0) return `${label} must not be blank`;
  if (value.length > MAX_SCOPE_LENGTH) return `${label} must not exceed ${MAX_SCOPE_LENGTH} characters`;
  return null;
}

/**
 * Validate a matrix entry. Returns null when valid, otherwise a human message
 * suitable for a 422 response.
 */
export function validateMatrixEntry(entry: MatrixEntryInput): string | null {
  if (typeof entry.triggerProductId !== "string" || entry.triggerProductId.trim().length === 0) {
    return "triggerProductId is required";
  }
  if (typeof entry.recommendedProductId !== "string" || entry.recommendedProductId.trim().length === 0) {
    return "recommendedProductId is required";
  }
  if (entry.triggerProductId === entry.recommendedProductId) {
    return "trigger and recommended product must differ";
  }
  if (!Number.isFinite(entry.priority) || !Number.isInteger(entry.priority) || entry.priority < 0) {
    return "priority must be a non-negative integer";
  }

  const segmentError = validateScopeValue("segment", entry.segment);
  if (segmentError) return segmentError;

  const channelError = validateScopeValue("channel", entry.channel);
  if (channelError) return channelError;

  return null;
}

/** Stable comparison key for duplicate detection. */
export function matrixKeyOf(entry: MatrixKey): string {
  return [
    entry.triggerProductId,
    entry.recommendedProductId,
    normaliseScopeValue(entry.segment),
    normaliseScopeValue(entry.channel),
  ].join("|");
}

/**
 * Find an existing entry that collides with `candidate` on
 * (triggerProductId, recommendedProductId, segment, channel).
 * Returns the colliding entry, or null when the candidate is unique.
 */
export function detectDuplicate<T extends MatrixKey>(
  existing: readonly T[],
  candidate: MatrixKey,
): T | null {
  const key = matrixKeyOf(candidate);
  for (const entry of existing) {
    if (matrixKeyOf(entry) === key) return entry;
  }
  return null;
}

// ── XS-001: per-cell weight + effective dating + companion resolution ─────────

/**
 * Weight is expressed in BASIS POINTS: 10000 bps = 100%.
 *
 * WHY bps and not a float or a numeric: the weight is a ratio, not money, so the
 * bigint-minor-units rule does not apply. But it is tenant-authored configuration
 * that is compared and ordered, and a binary float cannot represent 0.35 exactly,
 * so two cells authored as "35%" could sort inconsistently. An integer basis point
 * is exact, orders trivially, and survives JSON without a string wrapper.
 */
export const MAX_WEIGHT_BPS = 10_000;

/** An effective-dated configuration window. */
export interface EffectiveWindow {
  /** Inclusive lower bound. Null/undefined = effective since forever. */
  effectiveFrom?: Date | string | null | undefined;
  /** Exclusive upper bound. Null/undefined = never expires. */
  effectiveTo?: Date | string | null | undefined;
}

/**
 * Parse a bound into epoch millis. Returns null for an absent bound and NaN for
 * an unparseable one, so callers can distinguish "open" from "broken".
 */
function boundMs(value: Date | string | null | undefined): number | null {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.getTime();
  return new Date(value).getTime();
}

/**
 * Is this window live at `asOf`?
 *
 * Bound semantics are half-open, [from, to): a cell whose window ends exactly at
 * `asOf` is already expired. Half-open is what makes back-to-back windows
 * (to = next.from) cover the timeline with neither a gap nor an overlap, so
 * exactly one cell version is live at any instant.
 *
 * An unparseable bound fails closed (not effective) — a garbled date must not
 * silently widen a campaign window.
 */
export function isEffectiveAt(window: EffectiveWindow, asOf: Date): boolean {
  const at = asOf.getTime();
  if (!Number.isFinite(at)) return false;

  const from = boundMs(window.effectiveFrom);
  if (from !== null) {
    if (!Number.isFinite(from)) return false;
    if (at < from) return false;
  }

  const to = boundMs(window.effectiveTo);
  if (to !== null) {
    if (!Number.isFinite(to)) return false;
    if (at >= to) return false;
  }

  return true;
}

/**
 * Validate an effective window. Returns null when valid, else a 422 message.
 * A zero-length window (from === to) is rejected: under half-open semantics it
 * can never be live, so accepting it would silently create dead configuration.
 */
export function validateEffectiveWindow(window: EffectiveWindow): string | null {
  const from = boundMs(window.effectiveFrom);
  const to = boundMs(window.effectiveTo);

  if (from !== null && !Number.isFinite(from)) return "effectiveFrom is not a valid timestamp";
  if (to !== null && !Number.isFinite(to)) return "effectiveTo is not a valid timestamp";
  if (from !== null && to !== null && to <= from) {
    return "effectiveTo must be after effectiveFrom";
  }
  return null;
}

/** Validate a basis-point weight. Returns null when valid, else a 422 message. */
export function validateWeightBps(weightBps: number): string | null {
  if (!Number.isFinite(weightBps) || !Number.isInteger(weightBps)) {
    return "weightBps must be an integer";
  }
  if (weightBps < 0 || weightBps > MAX_WEIGHT_BPS) {
    return `weightBps must be between 0 and ${MAX_WEIGHT_BPS}`;
  }
  return null;
}

/** A resolvable matrix cell: the configuration row, reduced to what resolution needs. */
export interface MatrixCell extends MatrixKey, EffectiveWindow {
  id: string;
  priority: number;
  weightBps: number;
}

export interface ResolveCompanionsInput {
  /** Products the customer already holds. Drives which cells fire. */
  heldProductIds: readonly string[];
  /** The tenant's configured cells (already narrowed by segment/channel by the caller). */
  cells: readonly MatrixCell[];
  /** Point in time the resolution is for. */
  asOf: Date;
  /**
   * Drop companions the customer already holds. Default true — recommending a
   * product someone owns is the single most common cross-sell embarrassment.
   */
  excludeHeld?: boolean | undefined;
}

export interface ResolvedCompanion {
  recommendedProductId: string;
  /** Held products that triggered this companion, ascending for determinism. */
  triggerProductIds: string[];
  /** Matrix cells that contributed, ascending for determinism. */
  cellIds: string[];
  /** Highest priority among contributing cells. */
  priority: number;
  /** Highest weight among contributing cells, in basis points. */
  weightBps: number;
}

/**
 * Resolve the companion products for a set of holdings at a point in time.
 *
 * Two cells can recommend the same companion (e.g. two different held products
 * both point at it). They are COLLAPSED into one companion carrying the MAX
 * priority and MAX weight rather than a sum: a sum would let a tenant inflate a
 * product's rank just by authoring more rows for it, which is a configuration
 * accident, not a business signal.
 *
 * Ordering is total and therefore reproducible: priority DESC, weightBps DESC,
 * recommendedProductId ASC. The product id is unique per companion, so the
 * comparator never returns 0 for two distinct companions and the result does not
 * depend on input order or sort stability.
 *
 * PURE: no clock, no IO. `asOf` is a parameter for exactly that reason.
 */
export function resolveCompanions(input: ResolveCompanionsInput): ResolvedCompanion[] {
  const held = new Set(input.heldProductIds);
  const excludeHeld = input.excludeHeld !== false;

  const byProduct = new Map<string, ResolvedCompanion>();

  for (const cell of input.cells) {
    if (!held.has(cell.triggerProductId)) continue;
    if (!isEffectiveAt(cell, input.asOf)) continue;
    if (excludeHeld && held.has(cell.recommendedProductId)) continue;

    const existing = byProduct.get(cell.recommendedProductId);
    if (existing === undefined) {
      byProduct.set(cell.recommendedProductId, {
        recommendedProductId: cell.recommendedProductId,
        triggerProductIds: [cell.triggerProductId],
        cellIds: [cell.id],
        priority: cell.priority,
        weightBps: cell.weightBps,
      });
      continue;
    }

    if (!existing.triggerProductIds.includes(cell.triggerProductId)) {
      existing.triggerProductIds.push(cell.triggerProductId);
    }
    if (!existing.cellIds.includes(cell.id)) existing.cellIds.push(cell.id);
    if (cell.priority > existing.priority) existing.priority = cell.priority;
    if (cell.weightBps > existing.weightBps) existing.weightBps = cell.weightBps;
  }

  const asc = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

  const resolved = [...byProduct.values()];
  for (const companion of resolved) {
    companion.triggerProductIds.sort(asc);
    companion.cellIds.sort(asc);
  }

  return resolved.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (b.weightBps !== a.weightBps) return b.weightBps - a.weightBps;
    return asc(a.recommendedProductId, b.recommendedProductId);
  });
}
