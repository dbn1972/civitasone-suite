/**
 * G26 — slab discount schedules + delegation-of-authority: PURE DOMAIN tests
 * (src/modules/discounts/domain.ts).
 *
 * No database, no app, no clock. Everything asserted here is a total function of its
 * arguments, which is the point of keeping the pricing and authority rules out of the
 * routes: the interesting behaviour can be pinned exhaustively and cheaply.
 *
 * What is asserted:
 *   - SLAB BOUNDARIES, including the exact boundary volume. A half-open [from, to)
 *     interval means the boundary value belongs to the UPPER slab, and getting that
 *     wrong by one is the difference between two prices.
 *   - OVERLAP REJECTION, including the overlap that only shows up after sorting, the
 *     duplicate lower bound, and the unbounded slab that is not the highest.
 *   - EFFECTIVE DATING resolved as at a date, with an inclusive end bound, so a card
 *     change cannot retroactively reprice an approved quotation.
 *   - SUB-PAISA TRUNCATION toward zero, asserted explicitly on both signs, and money
 *     above 2^53 surviving exactly (a Number multiply gives a different answer, which
 *     one test pins).
 *   - AUTHORITY RESOLUTION at the limit and one basis point above it, escalation by
 *     seniority rather than by size, the beyond-delegation case, and the no-policy case
 *     that keeps a tenant which has not adopted G26 on its old behaviour.
 */
import { describe, it, expect } from "vitest";
import {
  MAX_DISCOUNT_BPS,
  SLAB_BASES,
  SCOPE_TYPES,
  AUTHORITY_OUTCOMES,
  applyDiscountBps,
  buildRateCard,
  canApprove,
  discountBpsFor,
  isEffectiveOn,
  isIsoDate,
  pickEffective,
  requesterAuthority,
  resolveApprovalAuthority,
  selectSlab,
  sortSlabs,
  validateSlabs,
  windowsOverlap,
  type DelegationLimit,
  type Slab,
} from "../src/modules/discounts/domain.js";

/** 2^53 + 1 — the smallest integer an IEEE-754 double cannot represent. */
const ABOVE_2_53 = 9_007_199_254_740_993n;

function slab(from: bigint, to: bigint | null, bps: number): Slab {
  return { fromThreshold: from, toThreshold: to, discountBps: bps };
}

/** A contiguous three-slab card: 0–9 @ 0%, 10–99 @ 5%, 100+ @ 12.5%. */
const CARD: Slab[] = [slab(0n, 10n, 0), slab(10n, 100n, 500), slab(100n, null, 1250)];

function limit(o: Partial<DelegationLimit> & { role: string; level: number; maxDiscountBps: number }): DelegationLimit {
  return { id: `lim-${o.role}`, effectiveFrom: "2026-01-01", effectiveTo: null, ...o };
}

// ══ constants ═══════════════════════════════════════════════════════════════

describe("constants", () => {
  it("a discount is bounded at 10000 basis points, i.e. exactly 100%", () => {
    expect(MAX_DISCOUNT_BPS).toBe(10_000);
  });

  it("exposes the closed sets the schema CHECK constraints mirror", () => {
    expect([...SLAB_BASES]).toEqual(["volume", "value"]);
    expect([...SCOPE_TYPES]).toEqual(["product", "price_book"]);
    expect([...AUTHORITY_OUTCOMES]).toEqual(["auto_approved", "approval_required", "beyond_delegation", "no_policy"]);
  });
});

// ══ slab validation ═════════════════════════════════════════════════════════

describe("validateSlabs", () => {
  it("accepts a contiguous card with an unbounded top slab", () => {
    expect(validateSlabs(CARD)).toEqual({ ok: true });
  });

  it("accepts a card with a GAP — a gap has one answer (no discount), an overlap has two", () => {
    expect(validateSlabs([slab(0n, 10n, 0), slab(50n, null, 500)])).toEqual({ ok: true });
  });

  it("rejects an empty slab set: a schedule with no slabs prices nothing", () => {
    const v = validateSlabs([]);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe("EMPTY_SLABS");
  });

  it("rejects a negative lower bound", () => {
    const v = validateSlabs([slab(-1n, 10n, 500)]);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe("NEGATIVE_THRESHOLD");
  });

  it("rejects an inverted slab (upper bound at or below the lower bound)", () => {
    for (const upper of [10n, 9n]) {
      const v = validateSlabs([slab(10n, upper, 500)]);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.code).toBe("INVERTED_SLAB");
    }
  });

  it("rejects a discount outside 0..10000 bps, and a non-integer bps", () => {
    for (const bps of [-1, 10_001, 12.5]) {
      const v = validateSlabs([slab(0n, null, bps)]);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.code).toBe("DISCOUNT_OUT_OF_RANGE");
    }
  });

  it("OVERLAP: rejects two slabs that share the same lower bound", () => {
    const v = validateSlabs([slab(10n, 20n, 500), slab(10n, 30n, 700)]);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe("OVERLAPPING_SLABS");
  });

  it("OVERLAP: rejects a partial overlap regardless of the order the slabs arrive in", () => {
    const overlapping = [slab(50n, 150n, 700), slab(0n, 100n, 500)];
    const v = validateSlabs(overlapping);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.code).toBe("OVERLAPPING_SLABS");
      // The message names the offending pair so an admin can fix it without guessing.
      expect(v.message).toContain("50");
      expect(v.message).toContain("100");
    }
    // Reversing the input must not change the verdict.
    expect(validateSlabs([...overlapping].reverse()).ok).toBe(false);
  });

  it("BOUNDARY: touching slabs are NOT an overlap — [0,10) then [10,20) is contiguous", () => {
    expect(validateSlabs([slab(0n, 10n, 0), slab(10n, 20n, 500)])).toEqual({ ok: true });
  });

  it("rejects an unbounded slab that is not the highest — it would swallow every slab above it", () => {
    const v = validateSlabs([slab(0n, null, 0), slab(100n, null, 1250)]);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe("UNBOUNDED_SLAB_NOT_LAST");
  });

  it("accepts a value-basis threshold above 2^53 — thresholds are bigint, not double", () => {
    expect(validateSlabs([slab(0n, ABOVE_2_53, 0), slab(ABOVE_2_53, null, 500)])).toEqual({ ok: true });
  });
});

describe("sortSlabs", () => {
  it("orders ascending by lower bound and does not mutate the input", () => {
    const input = [slab(100n, null, 1250), slab(0n, 10n, 0), slab(10n, 100n, 500)];
    const sorted = sortSlabs(input);
    expect(sorted.map((s) => s.fromThreshold)).toEqual([0n, 10n, 100n]);
    expect(input[0]?.fromThreshold).toBe(100n);
  });
});

// ══ slab selection ══════════════════════════════════════════════════════════

describe("selectSlab / discountBpsFor", () => {
  it("EXACT BOUNDARY: a measure equal to a slab's lower bound falls in the UPPER slab", () => {
    // [0,10) [10,100) [100,∞): 10 is the first quantity that earns 5%, not the last at 0%.
    expect(discountBpsFor(CARD, 9n)).toBe(0);
    expect(discountBpsFor(CARD, 10n)).toBe(500);
    expect(discountBpsFor(CARD, 99n)).toBe(500);
    expect(discountBpsFor(CARD, 100n)).toBe(1250);
  });

  it("the unbounded top slab covers everything above its lower bound, including huge volumes", () => {
    expect(discountBpsFor(CARD, ABOVE_2_53)).toBe(1250);
  });

  it("returns null (and 0 bps) below the lowest slab", () => {
    const highOnly = [slab(10n, null, 500)];
    expect(selectSlab(highOnly, 9n)).toBeNull();
    expect(discountBpsFor(highOnly, 9n)).toBe(0);
  });

  it("returns null (and 0 bps) inside a gap", () => {
    const gapped = [slab(0n, 10n, 0), slab(50n, null, 500)];
    expect(selectSlab(gapped, 25n)).toBeNull();
    expect(discountBpsFor(gapped, 25n)).toBe(0);
  });

  it("selection does not depend on the order the slabs are supplied in", () => {
    const shuffled = [CARD[2], CARD[0], CARD[1]].filter((s): s is Slab => s !== undefined);
    expect(discountBpsFor(shuffled, 10n)).toBe(500);
    expect(discountBpsFor(shuffled, 100n)).toBe(1250);
  });
});

// ══ money ═══════════════════════════════════════════════════════════════════

describe("applyDiscountBps", () => {
  it("computes an exact discount when the arithmetic divides cleanly", () => {
    // 10% of 1,000,000 paise = 100,000 paise.
    expect(applyDiscountBps(1_000_000n, 1000)).toEqual({
      grossMinor: 1_000_000n,
      discountBps: 1000,
      discountMinor: 100_000n,
      netMinor: 900_000n,
    });
  });

  it("SUB-PAISA: a discount smaller than one paisa TRUNCATES to zero, it does not round up", () => {
    // 1 paisa at 1 bps is 0.0001 paise. Rounding up would charge a discount the contract
    // does not support; truncation keeps gross - discount reconciling exactly.
    const r = applyDiscountBps(1n, 1);
    expect(r.discountMinor).toBe(0n);
    expect(r.netMinor).toBe(1n);
  });

  it("SUB-PAISA: the fractional part is dropped, never rounded to nearest", () => {
    // 12345 * 1234 / 10000 = 1523.373 -> 1523. Round-to-nearest would give 1523 too, so
    // pick a case where they differ: 12345 * 1239 / 10000 = 1529.5455 -> 1529, not 1530.
    expect(applyDiscountBps(12_345n, 1234).discountMinor).toBe(1_523n);
    expect(applyDiscountBps(12_345n, 1239).discountMinor).toBe(1_529n);
    // …and a case whose fraction is above .5, to prove no rounding is happening at all.
    // 999 * 5555 / 10000 = 554.9445 -> 554.
    expect(applyDiscountBps(999n, 5555).discountMinor).toBe(554n);
    // 1999 * 9999 / 10000 = 1998.8001 -> 1998, where round-to-nearest would say 1999.
    expect(applyDiscountBps(1_999n, 9999).discountMinor).toBe(1_998n);
  });

  it("TRUNCATES TOWARD ZERO, not toward negative infinity, on a negative gross", () => {
    // A credit note is the only way a negative gross reaches here. Floor would give -1524;
    // truncation toward zero gives -1523, so the magnitude of a discount never grows
    // merely because the amount changed sign.
    expect(applyDiscountBps(-12_345n, 1234).discountMinor).toBe(-1_523n);
    expect(applyDiscountBps(-12_345n, 1234).netMinor).toBe(-10_822n);
  });

  it("net always reconciles as gross - discount, with no residual paisa", () => {
    for (const gross of [0n, 1n, 7n, 999n, 12_345n, ABOVE_2_53]) {
      for (const bps of [0, 1, 500, 1234, 9999, 10_000]) {
        const r = applyDiscountBps(gross, bps);
        expect(r.netMinor + r.discountMinor).toBe(gross);
      }
    }
  });

  it("MONEY: an amount above 2^53 is discounted exactly", () => {
    const r = applyDiscountBps(ABOVE_2_53, 1000);
    expect(r.discountMinor).toBe(900_719_925_474_099n);
    // Proof the value is genuinely outside the range doubles represent exactly.
    expect(BigInt(Number(ABOVE_2_53))).not.toBe(ABOVE_2_53);
  });

  it("MONEY: the float route really does disagree, which is why this is BigInt", () => {
    // Deliberately 10_000 bps and not 1_000. Number(ABOVE_2_53) is off by exactly 1,
    // and at 1_000 bps the /10 that follows truncates that 1 away — both routes then
    // agree on 900_719_925_474_099 and the comparison proves nothing. At 10_000 bps
    // nothing divides the error away, so the divergence is visible: the BigInt route
    // keeps ...993 while the double route has already lost it to ...992.
    const exact = applyDiscountBps(ABOVE_2_53, 10_000).discountMinor;
    expect(exact).toBe(ABOVE_2_53);
    expect(BigInt(Math.trunc(Number(ABOVE_2_53) * 1.0))).not.toBe(exact);
  });

  it("0 bps is a no-op and 10000 bps discounts the whole amount", () => {
    expect(applyDiscountBps(500n, 0)).toMatchObject({ discountMinor: 0n, netMinor: 500n });
    expect(applyDiscountBps(500n, 10_000)).toMatchObject({ discountMinor: 500n, netMinor: 0n });
  });

  it("refuses an out-of-range or non-integer bps rather than silently clamping", () => {
    expect(() => applyDiscountBps(100n, -1)).toThrow(RangeError);
    expect(() => applyDiscountBps(100n, 10_001)).toThrow(RangeError);
    expect(() => applyDiscountBps(100n, 12.5)).toThrow(RangeError);
  });
});

// ══ effective dating ════════════════════════════════════════════════════════

describe("isIsoDate", () => {
  it("accepts YYYY-MM-DD and rejects anything else", () => {
    expect(isIsoDate("2026-04-01")).toBe(true);
    for (const bad of ["2026-4-1", "01-04-2026", "2026-04-01T00:00:00Z", "", "today"]) {
      expect(isIsoDate(bad)).toBe(false);
    }
  });
});

describe("isEffectiveOn", () => {
  const closed = { effectiveFrom: "2026-04-01", effectiveTo: "2026-06-30" };
  const open = { effectiveFrom: "2026-04-01", effectiveTo: null };

  it("BOUNDARY: both bounds are inclusive — the first and last day are in force", () => {
    expect(isEffectiveOn(closed, "2026-04-01")).toBe(true);
    expect(isEffectiveOn(closed, "2026-06-30")).toBe(true);
  });

  it("BOUNDARY: the day before the start and the day after the end are not in force", () => {
    expect(isEffectiveOn(closed, "2026-03-31")).toBe(false);
    expect(isEffectiveOn(closed, "2026-07-01")).toBe(false);
  });

  it("an open-ended window has no upper bound", () => {
    expect(isEffectiveOn(open, "2030-01-01")).toBe(true);
    expect(isEffectiveOn(open, "2026-03-31")).toBe(false);
  });
});

describe("pickEffective", () => {
  const q1 = { id: "q1", effectiveFrom: "2026-01-01", effectiveTo: "2026-03-31" };
  const q2 = { id: "q2", effectiveFrom: "2026-04-01", effectiveTo: null };

  it("HISTORY IS NOT REWRITTEN: a later card does not apply to an earlier date", () => {
    expect(pickEffective([q1, q2], "2026-02-15").map((r) => r.id)).toEqual(["q1"]);
    expect(pickEffective([q1, q2], "2026-04-02").map((r) => r.id)).toEqual(["q2"]);
  });

  it("returns nothing when no window covers the date", () => {
    expect(pickEffective([q1], "2025-12-31")).toEqual([]);
  });

  it("when several windows overlap, the most recently STARTED one comes first", () => {
    const wide = { id: "wide", effectiveFrom: "2026-01-01", effectiveTo: null };
    const narrow = { id: "narrow", effectiveFrom: "2026-04-01", effectiveTo: "2026-04-30" };
    expect(pickEffective([wide, narrow], "2026-04-15").map((r) => r.id)).toEqual(["narrow", "wide"]);
  });
});

describe("windowsOverlap", () => {
  it("detects an overlap in either direction and treats a shared day as an overlap", () => {
    const a = { effectiveFrom: "2026-01-01", effectiveTo: "2026-03-31" };
    const b = { effectiveFrom: "2026-03-31", effectiveTo: "2026-06-30" };
    expect(windowsOverlap(a, b)).toBe(true);
    expect(windowsOverlap(b, a)).toBe(true);
  });

  it("adjacent windows that do not share a day do not overlap", () => {
    const a = { effectiveFrom: "2026-01-01", effectiveTo: "2026-03-31" };
    const b = { effectiveFrom: "2026-04-01", effectiveTo: null };
    expect(windowsOverlap(a, b)).toBe(false);
    expect(windowsOverlap(b, a)).toBe(false);
  });

  it("two open-ended windows always overlap", () => {
    expect(windowsOverlap(
      { effectiveFrom: "2026-01-01", effectiveTo: null },
      { effectiveFrom: "2030-01-01", effectiveTo: null },
    )).toBe(true);
  });
});

// ══ rate card ═══════════════════════════════════════════════════════════════

describe("buildRateCard", () => {
  it("returns one ascending row per slab with the net unit price already worked out", () => {
    const card = buildRateCard(CARD, 1_000_000n);
    expect(card.map((r) => r.fromThreshold)).toEqual(["0", "10", "100"]);
    expect(card.map((r) => r.toThreshold)).toEqual(["10", "100", null]);
    expect(card.map((r) => r.discountBps)).toEqual([0, 500, 1250]);
    expect(card.map((r) => r.netUnitPriceMinor)).toEqual(["1000000", "950000", "875000"]);
    expect(card.map((r) => r.discountMinor)).toEqual(["0", "50000", "125000"]);
  });

  it("MONEY ON THE WIRE: every amount and threshold is a decimal STRING, never a number", () => {
    const row = buildRateCard([slab(0n, null, 1000)], ABOVE_2_53)[0];
    expect(row).toBeDefined();
    expect(typeof row?.unitPriceMinor).toBe("string");
    expect(typeof row?.netUnitPriceMinor).toBe("string");
    expect(typeof row?.fromThreshold).toBe("string");
    // Exact: JSON.parse of a number here would have lost the trailing digits.
    expect(row?.unitPriceMinor).toBe("9007199254740993");
    expect(row?.netUnitPriceMinor).toBe("8106479329266894");
  });

  it("SUB-PAISA on a rate card truncates the same way a single line does", () => {
    const row = buildRateCard([slab(0n, null, 1)], 1n)[0];
    expect(row?.discountMinor).toBe("0");
    expect(row?.netUnitPriceMinor).toBe("1");
  });
});

// ══ delegation of authority ═════════════════════════════════════════════════

const CHAIN: DelegationLimit[] = [
  limit({ role: "crm_user", level: 0, maxDiscountBps: 500 }),
  limit({ role: "crm_manager", level: 1, maxDiscountBps: 1500 }),
  limit({ role: "crm_admin", level: 2, maxDiscountBps: 3000 }),
];
const AS_AT = "2026-06-01";

describe("requesterAuthority", () => {
  it("a principal holding several roles is bounded by their MOST generous limit", () => {
    const best = requesterAuthority(["crm_user", "crm_manager"], CHAIN);
    expect(best?.role).toBe("crm_manager");
    expect(best?.maxDiscountBps).toBe(1500);
  });

  it("returns null when the principal holds no role that carries a limit", () => {
    expect(requesterAuthority(["auditor"], CHAIN)).toBeNull();
  });

  it("breaks a tie on equal limits by taking the more senior level", () => {
    const tied = [
      limit({ role: "a", level: 1, maxDiscountBps: 1000 }),
      limit({ role: "b", level: 3, maxDiscountBps: 1000 }),
    ];
    expect(requesterAuthority(["a", "b"], tied)?.role).toBe("b");
  });
});

describe("resolveApprovalAuthority", () => {
  it("AT THE LIMIT: a discount exactly equal to the limit is within authority", () => {
    const r = resolveApprovalAuthority(500, { roles: ["crm_user"] }, CHAIN, AS_AT);
    expect(r.outcome).toBe("auto_approved");
    expect(r.requesterLimit?.role).toBe("crm_user");
    expect(r.approverLimit?.role).toBe("crm_user");
    expect(r.requiredRole).toBeNull();
    expect(r.requiredLevel).toBeNull();
  });

  it("ONE BPS ABOVE THE LIMIT: escalates, and names the next role that can sign it", () => {
    const r = resolveApprovalAuthority(501, { roles: ["crm_user"] }, CHAIN, AS_AT);
    expect(r.outcome).toBe("approval_required");
    expect(r.requiredRole).toBe("crm_manager");
    expect(r.requiredLevel).toBe(1);
    expect(r.appliedLimitBpsIsRecorded ?? r.approverLimit?.maxDiscountBps).toBe(1500);
  });

  it("ESCALATION IS BY SENIORITY: the LOWEST level that covers the discount is chosen", () => {
    // 1600 bps exceeds the manager's 1500, so it must go to the admin — not to some other
    // level-1 role that happens to carry more.
    const r = resolveApprovalAuthority(1600, { roles: ["crm_user"] }, CHAIN, AS_AT);
    expect(r.requiredRole).toBe("crm_admin");
    expect(r.requiredLevel).toBe(2);
  });

  it("SEPARATION OF DUTIES: a PEER cannot approve, even holding a bigger limit", () => {
    // Both at level 1. The peer's 2000 covers the request, but a colleague at the same
    // level is not an escalation, so the chain must climb to level 2.
    const peers: DelegationLimit[] = [
      limit({ role: "crm_manager", level: 1, maxDiscountBps: 1500 }),
      limit({ role: "crm_manager_b", level: 1, maxDiscountBps: 2000 }),
      limit({ role: "crm_admin", level: 2, maxDiscountBps: 3000 }),
    ];
    const r = resolveApprovalAuthority(1800, { roles: ["crm_manager"] }, peers, AS_AT);
    expect(r.outcome).toBe("approval_required");
    expect(r.requiredRole).toBe("crm_admin");
    expect(r.requiredLevel).toBe(2);
  });

  it("a requester with NO limit escalates to the least senior role that can cover it", () => {
    const r = resolveApprovalAuthority(100, { roles: ["auditor"] }, CHAIN, AS_AT);
    expect(r.outcome).toBe("approval_required");
    expect(r.requesterLimit).toBeNull();
    expect(r.requiredRole).toBe("crm_user");
    expect(r.requiredLevel).toBe(0);
  });

  it("BEYOND DELEGATION: nobody can sign it, but it is still routed to the most senior role", () => {
    const r = resolveApprovalAuthority(9000, { roles: ["crm_user"] }, CHAIN, AS_AT);
    expect(r.outcome).toBe("beyond_delegation");
    expect(r.requiredRole).toBe("crm_admin");
    expect(r.requiredLevel).toBe(2);
    expect(r.approverLimit?.maxDiscountBps).toBe(3000);
  });

  it("NO POLICY: an unconfigured tenant is reported, not guessed at", () => {
    const r = resolveApprovalAuthority(2500, { roles: ["crm_admin"] }, [], AS_AT);
    expect(r.outcome).toBe("no_policy");
    expect(r.requesterLimit).toBeNull();
    expect(r.approverLimit).toBeNull();
    expect(r.requiredRole).toBeNull();
  });

  it("EFFECTIVE DATING: an EXPIRED limit is not authority, so the same request escalates", () => {
    const expired: DelegationLimit[] = [
      limit({ role: "crm_user", level: 0, maxDiscountBps: 500, effectiveTo: "2026-03-31" }),
      limit({ role: "crm_admin", level: 2, maxDiscountBps: 3000 }),
    ];
    // Inside the window the user's own 500 covers it…
    expect(resolveApprovalAuthority(500, { roles: ["crm_user"] }, expired, "2026-03-31").outcome).toBe("auto_approved");
    // …one day later that limit is gone, so the same discount needs the admin.
    const after = resolveApprovalAuthority(500, { roles: ["crm_user"] }, expired, "2026-04-01");
    expect(after.outcome).toBe("approval_required");
    expect(after.requiredRole).toBe("crm_admin");
  });

  it("EFFECTIVE DATING: a limit that has not started yet is not authority either", () => {
    const future = [limit({ role: "crm_user", level: 0, maxDiscountBps: 5000, effectiveFrom: "2027-01-01" })];
    expect(resolveApprovalAuthority(100, { roles: ["crm_user"] }, future, "2026-06-01").outcome).toBe("no_policy");
    expect(resolveApprovalAuthority(100, { roles: ["crm_user"] }, future, "2027-01-01").outcome).toBe("auto_approved");
  });

  it("EFFECTIVE DATING: a RAISED limit applies from its start date, not before", () => {
    const raised: DelegationLimit[] = [
      { id: "l-old", role: "crm_user", level: 0, maxDiscountBps: 500, effectiveFrom: "2026-01-01", effectiveTo: "2026-06-30" },
      { id: "l-new", role: "crm_user", level: 0, maxDiscountBps: 2000, effectiveFrom: "2026-07-01", effectiveTo: null },
    ];
    expect(resolveApprovalAuthority(1000, { roles: ["crm_user"] }, raised, "2026-06-30").outcome).toBe("beyond_delegation");
    const later = resolveApprovalAuthority(1000, { roles: ["crm_user"] }, raised, "2026-07-01");
    expect(later.outcome).toBe("auto_approved");
    expect(later.requesterLimit?.id).toBe("l-new");
  });

  it("a zero discount is always within authority when any limit is in force", () => {
    expect(resolveApprovalAuthority(0, { roles: ["crm_user"] }, CHAIN, AS_AT).outcome).toBe("auto_approved");
  });
});

describe("canApprove", () => {
  it("BOUNDARY: true at the approver's limit, false one basis point above it", () => {
    expect(canApprove(["crm_manager"], 1500, CHAIN, AS_AT)).toBe(true);
    expect(canApprove(["crm_manager"], 1501, CHAIN, AS_AT)).toBe(false);
  });

  it("false for a principal with no limit at all", () => {
    expect(canApprove(["auditor"], 1, CHAIN, AS_AT)).toBe(false);
  });

  it("false once the approver's limit has expired, even for a discount it used to cover", () => {
    const expiring = [limit({ role: "crm_admin", level: 2, maxDiscountBps: 3000, effectiveTo: "2026-05-31" })];
    expect(canApprove(["crm_admin"], 3000, expiring, "2026-05-31")).toBe(true);
    expect(canApprove(["crm_admin"], 3000, expiring, "2026-06-01")).toBe(false);
  });
});
