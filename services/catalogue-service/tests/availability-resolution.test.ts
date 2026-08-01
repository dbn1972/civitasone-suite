/**
 * Unit tests for the PURE PC-004 availability resolver and the QP-002 price
 * resolver. Both are pure functions — no DB, no Fastify.
 */
import { describe, it, expect } from "vitest";
import {
  resolveAvailability,
  ruleMatchesLocation,
  specificityScore,
  ruleIsEffective,
  type AvailabilityRule,
} from "../src/modules/products/availability-domain.js";
import {
  resolveEffectivePrice,
  geographyMatch,
  bookIsEligible,
  taxOnAmountMinor,
  type CandidateBook,
  type CandidateEntry,
} from "../src/modules/price-books/domain.js";

function rule(partial: Partial<AvailabilityRule>): AvailabilityRule {
  return {
    circleCode: null,
    regionCode: null,
    officeCode: null,
    available: true,
    effectiveFrom: null,
    effectiveTo: null,
    ...partial,
  };
}

const QUERY = { circleCode: "KA", regionCode: "BLR", officeCode: "BLR-001" };

// ═══════════════════════════════════════════════════════════════════════════════
// PC-004 — most-specific-wins
// ═══════════════════════════════════════════════════════════════════════════════
describe("PC-004 rule matching", () => {
  it("matches a full-wildcard rule against any location", () => {
    expect(ruleMatchesLocation(rule({}), QUERY)).toBe(true);
    expect(ruleMatchesLocation(rule({}), {})).toBe(true);
  });

  it("matches when every named level equals the query", () => {
    expect(ruleMatchesLocation(rule({ circleCode: "KA" }), QUERY)).toBe(true);
    expect(ruleMatchesLocation(rule({ circleCode: "KA", regionCode: "BLR" }), QUERY)).toBe(true);
  });

  it("does not match when a named level differs", () => {
    expect(ruleMatchesLocation(rule({ circleCode: "TN" }), QUERY)).toBe(false);
    expect(ruleMatchesLocation(rule({ officeCode: "BLR-999" }), QUERY)).toBe(false);
  });

  it("excludes a rule that is more specific than the query", () => {
    // Rule names an office but the query only knows the circle.
    expect(ruleMatchesLocation(rule({ officeCode: "BLR-001" }), { circleCode: "KA" })).toBe(false);
  });

  it("scores specificity office > region > circle", () => {
    expect(specificityScore(rule({}))).toBe(0);
    expect(specificityScore(rule({ circleCode: "KA" }))).toBe(1);
    expect(specificityScore(rule({ regionCode: "BLR" }))).toBe(2);
    expect(specificityScore(rule({ officeCode: "BLR-001" }))).toBe(4);
    // An office row always outscores any circle+region row.
    expect(specificityScore(rule({ officeCode: "X" })))
      .toBeGreaterThan(specificityScore(rule({ circleCode: "KA", regionCode: "BLR" })));
  });
});

describe("PC-004 effective-date windows", () => {
  const now = new Date("2026-06-15T00:00:00Z");

  it("treats a rule with no dates as always in force", () => {
    expect(ruleIsEffective(rule({}), now)).toBe(true);
  });

  it("excludes a rule that has not started", () => {
    expect(ruleIsEffective(rule({ effectiveFrom: new Date("2026-07-01T00:00:00Z") }), now)).toBe(false);
  });

  it("excludes a rule that has already ended", () => {
    expect(ruleIsEffective(rule({ effectiveTo: new Date("2026-01-01T00:00:00Z") }), now)).toBe(false);
  });

  it("includes a rule inside its window", () => {
    expect(ruleIsEffective(rule({
      effectiveFrom: new Date("2026-01-01T00:00:00Z"),
      effectiveTo: new Date("2026-12-31T00:00:00Z"),
    }), now)).toBe(true);
  });

  it("ignores an expired rule during resolution", () => {
    const result = resolveAvailability([
      rule({ circleCode: "KA", available: true, effectiveTo: new Date("2026-01-01T00:00:00Z") }),
    ], QUERY, now);
    expect(result.available).toBe(false);
    expect(result.matchedRule).toBeNull();
  });
});

describe("PC-004 most-specific-wins resolution", () => {
  it("denies by default when nothing matches", () => {
    const result = resolveAvailability([], QUERY);
    expect(result.available).toBe(false);
    expect(result.matchedRule).toBeNull();
    expect(result.specificity).toBeNull();
    expect(result.candidateCount).toBe(0);
  });

  it("lets an office DENY override a circle ALLOW", () => {
    const result = resolveAvailability([
      rule({ circleCode: "KA", available: true }),
      rule({ circleCode: "KA", regionCode: "BLR", officeCode: "BLR-001", available: false }),
    ], QUERY);
    expect(result.available).toBe(false);
    expect(result.matchedRule?.officeCode).toBe("BLR-001");
    expect(result.specificity).toBe(7); // 4 + 2 + 1
    expect(result.candidateCount).toBe(2);
  });

  it("lets an office ALLOW override a circle DENY", () => {
    const result = resolveAvailability([
      rule({ circleCode: "KA", available: false }),
      rule({ circleCode: "KA", regionCode: "BLR", officeCode: "BLR-001", available: true }),
    ], QUERY);
    expect(result.available).toBe(true);
    expect(result.matchedRule?.officeCode).toBe("BLR-001");
  });

  it("lets a region rule override a circle rule", () => {
    const result = resolveAvailability([
      rule({ circleCode: "KA", available: true }),
      rule({ circleCode: "KA", regionCode: "BLR", available: false }),
    ], QUERY);
    expect(result.available).toBe(false);
    expect(result.matchedRule?.regionCode).toBe("BLR");
  });

  it("falls back to a broader rule when no narrow rule matches the location", () => {
    const result = resolveAvailability([
      rule({ circleCode: "KA", available: true }),
      rule({ circleCode: "KA", regionCode: "MYS", officeCode: "MYS-007", available: false }),
    ], QUERY);
    // The MYS office rule does not apply to BLR-001, so the circle rule wins.
    expect(result.available).toBe(true);
    expect(result.matchedRule?.regionCode).toBeNull();
    expect(result.candidateCount).toBe(1);
  });

  it("is insensitive to the order rules are supplied in", () => {
    const broad = rule({ circleCode: "KA", available: true });
    const narrow = rule({ circleCode: "KA", regionCode: "BLR", officeCode: "BLR-001", available: false });
    expect(resolveAvailability([broad, narrow], QUERY).available).toBe(false);
    expect(resolveAvailability([narrow, broad], QUERY).available).toBe(false);
  });

  it("breaks an exact tie in favour of DENY (safer resolution)", () => {
    const allow = rule({ circleCode: "KA", regionCode: "BLR", officeCode: "BLR-001", available: true });
    const deny = rule({ circleCode: "KA", regionCode: "BLR", officeCode: "BLR-001", available: false });
    expect(resolveAvailability([allow, deny], QUERY).available).toBe(false);
    expect(resolveAvailability([deny, allow], QUERY).available).toBe(false);
  });

  it("uses a tenant-wide wildcard row when the query names no location", () => {
    const result = resolveAvailability([rule({ available: true })], {});
    expect(result.available).toBe(true);
    expect(result.specificity).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// QP-002 — price resolution (all money as bigint)
// ═══════════════════════════════════════════════════════════════════════════════
function book(partial: Partial<CandidateBook>): CandidateBook {
  return {
    id: "book-1",
    segment: "retail",
    currency: "INR",
    geography: {},
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    effectiveTo: null,
    status: "active",
    ...partial,
  };
}

function entry(partial: Partial<CandidateEntry>): CandidateEntry {
  return {
    priceBookId: "book-1",
    productId: "prod-1",
    amountMinor: 10000n,
    currency: "INR",
    ...partial,
  };
}

const AT = new Date("2026-06-15T00:00:00Z");
const PARAMS = { productId: "prod-1", segment: "retail", currency: "INR" };

describe("QP-002 book eligibility", () => {
  it("accepts an active in-window book", () => {
    expect(bookIsEligible(book({}), AT)).toBe(true);
  });

  it("rejects a draft or archived book", () => {
    expect(bookIsEligible(book({ status: "draft" }), AT)).toBe(false);
    expect(bookIsEligible(book({ status: "archived" }), AT)).toBe(false);
  });

  it("rejects a book that has not started or has expired", () => {
    expect(bookIsEligible(book({ effectiveFrom: new Date("2027-01-01T00:00:00Z") }), AT)).toBe(false);
    expect(bookIsEligible(book({ effectiveTo: new Date("2026-02-01T00:00:00Z") }), AT)).toBe(false);
  });
});

describe("QP-002 geography matching", () => {
  it("treats an empty geography as a wildcard", () => {
    expect(geographyMatch({}, {})).toEqual({ matches: true, score: 0 });
    expect(geographyMatch({}, { circleCode: "KA" })).toEqual({ matches: true, score: 0 });
  });

  it("scores named levels office > region > circle", () => {
    expect(geographyMatch({ circleCode: "KA" }, { circleCode: "KA" }).score).toBe(1);
    expect(geographyMatch({ regionCode: "BLR" }, { regionCode: "BLR" }).score).toBe(2);
    expect(geographyMatch({ officeCode: "B1" }, { officeCode: "B1" }).score).toBe(4);
  });

  it("does not match a differing or missing level", () => {
    expect(geographyMatch({ circleCode: "KA" }, { circleCode: "TN" }).matches).toBe(false);
    expect(geographyMatch({ circleCode: "KA" }, {}).matches).toBe(false);
  });

  it("does not match a non-string geography value", () => {
    expect(geographyMatch({ circleCode: 42 }, { circleCode: "42" }).matches).toBe(false);
  });
});

describe("QP-002 effective price resolution", () => {
  it("returns null when no book matches the segment or currency", () => {
    expect(resolveEffectivePrice([book({ segment: "corporate" })], [entry({})], PARAMS, AT)).toBeNull();
    expect(resolveEffectivePrice([book({ currency: "USD" })], [entry({})], PARAMS, AT)).toBeNull();
  });

  it("returns null when a matching book has no entry for the product", () => {
    expect(resolveEffectivePrice([book({})], [entry({ productId: "other" })], PARAMS, AT)).toBeNull();
  });

  it("resolves the price from the only matching book", () => {
    const result = resolveEffectivePrice([book({})], [entry({ amountMinor: 12345n })], PARAMS, AT);
    expect(result?.amountMinor).toBe(12345n);
    expect(result?.priceBookId).toBe("book-1");
  });

  it("prefers the geographically more specific book", () => {
    const result = resolveEffectivePrice(
      [
        book({ id: "wide", geography: {} }),
        book({ id: "narrow", geography: { circleCode: "KA", regionCode: "BLR" } }),
      ],
      [
        entry({ priceBookId: "wide", amountMinor: 90000n }),
        entry({ priceBookId: "narrow", amountMinor: 80000n }),
      ],
      { ...PARAMS, geography: { circleCode: "KA", regionCode: "BLR" } },
      AT,
    );
    expect(result?.priceBookId).toBe("narrow");
    expect(result?.amountMinor).toBe(80000n);
    expect(result?.specificity).toBe(3);
  });

  it("breaks a specificity tie on the later effectiveFrom", () => {
    const result = resolveEffectivePrice(
      [
        book({ id: "older", effectiveFrom: new Date("2026-01-01T00:00:00Z") }),
        book({ id: "newer", effectiveFrom: new Date("2026-05-01T00:00:00Z") }),
      ],
      [
        entry({ priceBookId: "older", amountMinor: 500n }),
        entry({ priceBookId: "newer", amountMinor: 700n }),
      ],
      PARAMS,
      AT,
    );
    expect(result?.priceBookId).toBe("newer");
  });

  it("breaks a full tie on the lower amount so a duplicate never overcharges", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    const result = resolveEffectivePrice(
      [book({ id: "a", effectiveFrom: from }), book({ id: "b", effectiveFrom: from })],
      [
        entry({ priceBookId: "a", amountMinor: 900n }),
        entry({ priceBookId: "b", amountMinor: 800n }),
      ],
      PARAMS,
      AT,
    );
    expect(result?.amountMinor).toBe(800n);
  });

  it("compares amounts exactly above 2^53 using bigint (no float collapse)", () => {
    // These two paise values differ by 1 but are INDISTINGUISHABLE as doubles.
    const a = 9007199254740992n; // 2^53
    const b = 9007199254740993n; // 2^53 + 1
    expect(a === b).toBe(false); // exact as bigint
    expect(Number(a) === Number(b)).toBe(true); // proves the float hazard
    const from = new Date("2026-01-01T00:00:00Z");
    const result = resolveEffectivePrice(
      [book({ id: "a", effectiveFrom: from }), book({ id: "b", effectiveFrom: from })],
      [entry({ priceBookId: "a", amountMinor: b }), entry({ priceBookId: "b", amountMinor: a })],
      PARAMS,
      AT,
    );
    expect(result?.amountMinor).toBe(a);
  });

  it("ignores entries whose currency differs from the request", () => {
    expect(resolveEffectivePrice([book({})], [entry({ currency: "USD" })], PARAMS, AT)).toBeNull();
  });
});

describe("QP-002 tax on bigint amounts", () => {
  it("computes basis-point tax entirely in BigInt", () => {
    expect(taxOnAmountMinor(100000n, 1800)).toBe(18000n); // 18% of 1000.00
    expect(taxOnAmountMinor(100000n, 0)).toBe(0n);
    expect(taxOnAmountMinor(0n, 1800)).toBe(0n);
  });

  it("truncates sub-paise remainders toward zero", () => {
    // 1 paise * 18% = 0.18 paise -> 0
    expect(taxOnAmountMinor(1n, 1800)).toBe(0n);
    // 99 paise * 18% = 17.82 paise -> 17 (truncated, not rounded up)
    expect(taxOnAmountMinor(99n, 1800)).toBe(17n);
    // 55 paise * 1% = 0.55 paise -> 0
    expect(taxOnAmountMinor(55n, 100)).toBe(0n);
  });

  it("stays exact on amounts above 2^53", () => {
    const huge = 9007199254740993n; // 2^53 + 1
    expect(taxOnAmountMinor(huge, 10000)).toBe(huge); // 100% of it, unchanged
  });

  it("rejects a non-integer basis-point rate", () => {
    expect(() => taxOnAmountMinor(1000n, 12.5)).toThrow(TypeError);
  });
});
