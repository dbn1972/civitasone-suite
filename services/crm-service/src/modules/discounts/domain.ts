/**
 * G26 — slab-based discount schedules + delegation-of-authority resolution.
 *
 * PURE. No I/O, no clock, no database. Everything here is a total function of its
 * arguments so the whole of the interesting behaviour is unit-testable, and so the
 * quotation approval path and the rate-card endpoint cannot disagree about the answer.
 *
 * MONEY / RATES — two rules that the rest of this module exists to protect:
 *
 *  1. A discount is always an INTEGER NUMBER OF BASIS POINTS (bps): 1 bps = 0.01%,
 *     so 10000 bps = 100%. Never a floating-point percentage. A percentage held as a
 *     double drifts against the contract value it is derived from, and a quotation that
 *     disagrees with its contract by a single paisa is a dispute, not a rounding note.
 *
 *  2. Money is bigint MINOR units (paise) and every arithmetic step is BigInt. The
 *     discount on a value is `value * bps / 10000` evaluated in BigInt, so the division
 *     TRUNCATES TOWARD ZERO. A sub-paisa discount is therefore dropped rather than
 *     rounded up — the customer is never charged a fraction of a paisa, and the same
 *     inputs always give the same output on every machine.
 *
 * EFFECTIVE DATING — a rate card is a dated document. Changing next quarter's slabs must
 * not rewrite the discount a quotation was approved at last quarter, so schedules and
 * delegation limits carry `effectiveFrom` / `effectiveTo` and are resolved AS AT a date.
 * `effectiveTo` is INCLUSIVE: it is the last day the row applies.
 *
 * PRODUCT-AGNOSTIC by construction: a slab is a threshold and a bps figure. What is being
 * sold, and any lane / service / tariff naming, is seed data in the scoped product or
 * price book, never a branch in this file.
 */

// ── slab shape ──────────────────────────────────────────────────────────────

/** What a slab's thresholds are measured in. */
export const SLAB_BASES = ["volume", "value"] as const;
export type SlabBasis = (typeof SLAB_BASES)[number];

/** What a schedule is attached to. */
export const SCOPE_TYPES = ["product", "price_book"] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];

/**
 * One slab of a discount schedule.
 *
 * The interval is HALF-OPEN — `[fromThreshold, toThreshold)`. A half-open upper bound is
 * what lets contiguous slabs be written without a gap and without an overlap: 0–9, 10–99,
 * 100+ is `[0,10) [10,100) [100,null)`. A closed upper bound would force every author to
 * remember to write `9` rather than `10`, and getting it wrong is either a silent gap
 * (no discount at exactly the boundary) or a silent overlap (two answers).
 *
 * `toThreshold: null` means unbounded above, and only the last slab may be unbounded.
 *
 * Thresholds are integers held as bigint: units for a `volume` basis, MINOR units for a
 * `value` basis. bigint on both so a value slab can express a threshold above 2^53.
 */
export interface Slab {
  readonly fromThreshold: bigint;
  readonly toThreshold: bigint | null;
  readonly discountBps: number;
}

export const MAX_DISCOUNT_BPS = 10_000;

export type SlabErrorCode =
  | "EMPTY_SLABS"
  | "NEGATIVE_THRESHOLD"
  | "INVERTED_SLAB"
  | "DISCOUNT_OUT_OF_RANGE"
  | "OVERLAPPING_SLABS"
  | "UNBOUNDED_SLAB_NOT_LAST";

export type SlabValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: SlabErrorCode; readonly message: string };

function invalid(code: SlabErrorCode, message: string): SlabValidation {
  return { ok: false, code, message };
}

/** Ascending by lower bound. Callers get a stable order regardless of input order. */
export function sortSlabs(slabs: readonly Slab[]): Slab[] {
  return [...slabs].sort((a, b) => (a.fromThreshold < b.fromThreshold ? -1 : a.fromThreshold > b.fromThreshold ? 1 : 0));
}

/**
 * Reject a slab set that cannot produce one unambiguous answer.
 *
 * Overlap is the failure that matters: if two slabs both cover a volume then the discount
 * depends on row order, which means the same quotation can price differently on a re-read.
 * That is rejected at the boundary rather than resolved by a tie-break, because a tie-break
 * would silently pick one of two prices the author did not intend.
 */
export function validateSlabs(slabs: readonly Slab[]): SlabValidation {
  if (slabs.length === 0) return invalid("EMPTY_SLABS", "a discount schedule needs at least one slab");

  for (const s of slabs) {
    if (s.fromThreshold < 0n) {
      return invalid("NEGATIVE_THRESHOLD", `slab lower bound ${s.fromThreshold} is negative`);
    }
    if (s.toThreshold !== null && s.toThreshold <= s.fromThreshold) {
      return invalid(
        "INVERTED_SLAB",
        `slab upper bound ${s.toThreshold} must be greater than its lower bound ${s.fromThreshold}`,
      );
    }
    if (!Number.isInteger(s.discountBps) || s.discountBps < 0 || s.discountBps > MAX_DISCOUNT_BPS) {
      return invalid(
        "DISCOUNT_OUT_OF_RANGE",
        `discount must be an integer between 0 and ${MAX_DISCOUNT_BPS} basis points, got ${s.discountBps}`,
      );
    }
  }

  const ordered = sortSlabs(slabs);
  for (let i = 0; i < ordered.length - 1; i += 1) {
    const lower = ordered[i];
    const upper = ordered[i + 1];
    if (lower === undefined || upper === undefined) continue;
    if (lower.toThreshold === null) {
      return invalid(
        "UNBOUNDED_SLAB_NOT_LAST",
        `the unbounded slab starting at ${lower.fromThreshold} must be the highest slab`,
      );
    }
    if (upper.fromThreshold < lower.toThreshold) {
      return invalid(
        "OVERLAPPING_SLABS",
        `slab starting at ${upper.fromThreshold} overlaps the slab ending at ${lower.toThreshold}`,
      );
    }
  }
  return { ok: true };
}

/**
 * The slab covering `measure`, or null when the measure falls in a gap or below the
 * lowest slab. A gap is legal (it simply means no discount there) — only an OVERLAP is
 * rejected, because a gap has one unambiguous answer and an overlap has two.
 */
export function selectSlab(slabs: readonly Slab[], measure: bigint): Slab | null {
  for (const s of sortSlabs(slabs)) {
    if (measure < s.fromThreshold) continue;
    if (s.toThreshold === null || measure < s.toThreshold) return s;
  }
  return null;
}

/** The discount in bps that applies at `measure`; 0 when no slab covers it. */
export function discountBpsFor(slabs: readonly Slab[], measure: bigint): number {
  return selectSlab(slabs, measure)?.discountBps ?? 0;
}

export interface DiscountedAmount {
  readonly grossMinor: bigint;
  readonly discountBps: number;
  readonly discountMinor: bigint;
  readonly netMinor: bigint;
}

/**
 * Apply a bps discount to a minor-unit amount.
 *
 * `gross * bps / 10000` in BigInt. BigInt division truncates TOWARD ZERO, so a sub-paisa
 * discount becomes 0 rather than 1: the discount is never rounded in the customer's
 * favour against the contract, and the net amount always reconciles exactly as
 * `gross - discount` with no residual.
 */
export function applyDiscountBps(grossMinor: bigint, discountBps: number): DiscountedAmount {
  if (!Number.isInteger(discountBps) || discountBps < 0 || discountBps > MAX_DISCOUNT_BPS) {
    throw new RangeError(`discountBps must be an integer between 0 and ${MAX_DISCOUNT_BPS}, got ${discountBps}`);
  }
  const discountMinor = (grossMinor * BigInt(discountBps)) / BigInt(MAX_DISCOUNT_BPS);
  return { grossMinor, discountBps, discountMinor, netMinor: grossMinor - discountMinor };
}

// ── effective dating ────────────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a `YYYY-MM-DD` calendar date. Dates are compared lexicographically. */
export function isIsoDate(value: string): boolean {
  return ISO_DATE.test(value);
}

export interface EffectiveWindow {
  readonly effectiveFrom: string;
  /** INCLUSIVE last day the row applies; null means open-ended. */
  readonly effectiveTo: string | null;
}

/** True when `asAt` falls inside the window (both bounds inclusive). */
export function isEffectiveOn(w: EffectiveWindow, asAt: string): boolean {
  if (asAt < w.effectiveFrom) return false;
  if (w.effectiveTo !== null && asAt > w.effectiveTo) return false;
  return true;
}

/** Every row in force on `asAt`, most recently started first. */
export function pickEffective<T extends EffectiveWindow>(rows: readonly T[], asAt: string): T[] {
  return rows
    .filter((r) => isEffectiveOn(r, asAt))
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : 0));
}

/** True when the two windows overlap on at least one day. */
export function windowsOverlap(a: EffectiveWindow, b: EffectiveWindow): boolean {
  const aEndsBeforeB = a.effectiveTo !== null && a.effectiveTo < b.effectiveFrom;
  const bEndsBeforeA = b.effectiveTo !== null && b.effectiveTo < a.effectiveFrom;
  return !aEndsBeforeB && !bEndsBeforeA;
}

// ── rate card ───────────────────────────────────────────────────────────────

export interface RateCardRow {
  readonly fromThreshold: string;
  readonly toThreshold: string | null;
  readonly discountBps: number;
  readonly unitPriceMinor: string;
  readonly discountMinor: string;
  readonly netUnitPriceMinor: string;
}

/**
 * The rate card for a schedule: one row per slab, ascending, with the discounted unit
 * price already worked out. Money leaves as a decimal STRING of minor units — a JSON
 * number would silently lose precision above 2^53 in any client that parses it as a
 * double, and a rate card is exactly the document a client stores and later reconciles.
 */
export function buildRateCard(slabs: readonly Slab[], unitPriceMinor: bigint): RateCardRow[] {
  return sortSlabs(slabs).map((s) => {
    const applied = applyDiscountBps(unitPriceMinor, s.discountBps);
    return {
      fromThreshold: s.fromThreshold.toString(),
      toThreshold: s.toThreshold === null ? null : s.toThreshold.toString(),
      discountBps: s.discountBps,
      unitPriceMinor: unitPriceMinor.toString(),
      discountMinor: applied.discountMinor.toString(),
      netUnitPriceMinor: applied.netMinor.toString(),
    };
  });
}

// ── delegation of authority ─────────────────────────────────────────────────

/**
 * The maximum discount a role may grant without escalating, in force over a date window.
 *
 * `level` orders the escalation chain — higher is more senior. It is deliberately separate
 * from `maxDiscountBps`: two roles at the same level may hold different authority, and the
 * chain must escalate by level so a peer with a slightly larger limit is not treated as an
 * approver for their own colleague.
 */
export interface DelegationLimit extends EffectiveWindow {
  readonly id: string;
  readonly role: string;
  readonly level: number;
  readonly maxDiscountBps: number;
}

export const AUTHORITY_OUTCOMES = ["auto_approved", "approval_required", "beyond_delegation", "no_policy"] as const;
export type AuthorityOutcome = (typeof AUTHORITY_OUTCOMES)[number];

export interface AuthorityResolution {
  readonly outcome: AuthorityOutcome;
  readonly requestedBps: number;
  /** The requester's own authority, applied to decide whether escalation is needed. */
  readonly requesterLimit: DelegationLimit | null;
  /** The limit that must sign this off; null when nobody in the chain can. */
  readonly approverLimit: DelegationLimit | null;
  readonly requiredRole: string | null;
  readonly requiredLevel: number | null;
}

/**
 * The requester's own authority: the most generous limit among the roles they hold. A user
 * with several roles is bounded by their BEST one, which is what "the authority this person
 * carries" means; taking the worst would make adding a junior role remove authority.
 */
export function requesterAuthority(
  roles: readonly string[],
  limits: readonly DelegationLimit[],
): DelegationLimit | null {
  const held = new Set(roles);
  let best: DelegationLimit | null = null;
  for (const l of limits) {
    if (!held.has(l.role)) continue;
    if (best === null || l.maxDiscountBps > best.maxDiscountBps || (l.maxDiscountBps === best.maxDiscountBps && l.level > best.level)) {
      best = l;
    }
  }
  return best;
}

/** Deterministic escalation order: least senior first, then smallest limit, then role name. */
function escalationOrder(a: DelegationLimit, b: DelegationLimit): number {
  if (a.level !== b.level) return a.level - b.level;
  if (a.maxDiscountBps !== b.maxDiscountBps) return a.maxDiscountBps - b.maxDiscountBps;
  return a.role < b.role ? -1 : a.role > b.role ? 1 : 0;
}

/**
 * G26 core decision: may this requester grant this discount, and if not, who must approve it?
 *
 * Boundary semantics: a discount EQUAL to the limit is within authority (the limit is the
 * most the holder may grant); one basis point above it escalates. That is the whole point
 * of an integer bps figure — "at the limit" is an exact, arguable-free comparison.
 *
 * `no_policy` is returned rather than a guess when the tenant has configured no limits in
 * force on `asAt`. Silently auto-approving would hand out unlimited authority the moment a
 * limit expired; silently escalating would block every quotation in a tenant that has not
 * configured G26 yet. The caller decides, and the existing threshold policy remains the
 * fallback.
 */
export function resolveApprovalAuthority(
  requestedBps: number,
  requester: { readonly roles: readonly string[] },
  limits: readonly DelegationLimit[],
  asAt: string,
): AuthorityResolution {
  const inForce = pickEffective(limits, asAt);
  if (inForce.length === 0) {
    return {
      outcome: "no_policy",
      requestedBps,
      requesterLimit: null,
      approverLimit: null,
      requiredRole: null,
      requiredLevel: null,
    };
  }

  const own = requesterAuthority(requester.roles, inForce);
  if (own !== null && requestedBps <= own.maxDiscountBps) {
    return {
      outcome: "auto_approved",
      requestedBps,
      requesterLimit: own,
      approverLimit: own,
      requiredRole: null,
      requiredLevel: null,
    };
  }

  // An approver must both cover the discount AND outrank the requester — a peer cannot
  // rubber-stamp a colleague's exception, which is the separation-of-duties point of a
  // delegation chain.
  const minLevel = own?.level ?? Number.NEGATIVE_INFINITY;
  const candidates = inForce
    .filter((l) => l.maxDiscountBps >= requestedBps && l.level > minLevel)
    .sort(escalationOrder);

  const chosen = candidates[0];
  if (chosen !== undefined) {
    return {
      outcome: "approval_required",
      requestedBps,
      requesterLimit: own,
      approverLimit: chosen,
      requiredRole: chosen.role,
      requiredLevel: chosen.level,
    };
  }

  // Nobody in the chain carries this much authority. The request is still routed to the
  // most senior limit that exists, so it lands with a human rather than disappearing.
  const top = [...inForce].sort(escalationOrder).at(-1) ?? null;
  return {
    outcome: "beyond_delegation",
    requestedBps,
    requesterLimit: own,
    approverLimit: top,
    requiredRole: top?.role ?? null,
    requiredLevel: top?.level ?? null,
  };
}

/**
 * May a principal holding `roles` approve a discount of `requestedBps`? Used on the decide
 * path so the sign-off is checked against the SAME limits the request was routed by,
 * rather than against a role name copied onto the approval row.
 */
export function canApprove(
  roles: readonly string[],
  requestedBps: number,
  limits: readonly DelegationLimit[],
  asAt: string,
): boolean {
  const own = requesterAuthority(roles, pickEffective(limits, asAt));
  return own !== null && requestedBps <= own.maxDiscountBps;
}
