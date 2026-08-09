/**
 * Catalogue Service — Price Books: World-class domain tests.
 *
 * Tests price resolution with geography specificity, effective-date windows,
 * bigint money tie-breaking, tax computation, and edge cases.
 *
 * Source: modules/price-books/domain.ts
 */
import { describe, it, expect } from "vitest";
import { bookIsEligible, geographyMatch, resolveEffectivePrice, taxOnAmountMinor, type CandidateBook, type CandidateEntry, type GeographyQuery } from "../src/modules/price-books/domain.js";

const now = new Date("2026-07-15T10:00:00Z");

function book(overrides: Partial<CandidateBook> & { id: string }): CandidateBook {
  return { segment: "govt", currency: "INR", geography: {}, effectiveFrom: new Date("2026-01-01"), effectiveTo: null, status: "active", ...overrides };
}
function entry(bookId: string, productId: string, amountMinor: bigint): CandidateEntry {
  return { priceBookId: bookId, productId, amountMinor, currency: "INR" };
}

// ═══ bookIsEligible ═══

describe("bookIsEligible — effective window + status gate", () => {
  it("active book within window = eligible", () => {
    expect(bookIsEligible(book({ id: "b1" }), now)).toBe(true);
  });
  it("inactive book = not eligible", () => {
    expect(bookIsEligible(book({ id: "b1", status: "draft" }), now)).toBe(false);
  });
  it("future effectiveFrom = not eligible", () => {
    expect(bookIsEligible(book({ id: "b1", effectiveFrom: new Date("2027-01-01") }), now)).toBe(false);
  });
  it("past effectiveTo = not eligible", () => {
    expect(bookIsEligible(book({ id: "b1", effectiveTo: new Date("2026-06-30") }), now)).toBe(false);
  });
  it("null effectiveTo = no end (eligible forever)", () => {
    expect(bookIsEligible(book({ id: "b1", effectiveTo: null }), now)).toBe(true);
  });
  it("effectiveTo in future = still eligible", () => {
    expect(bookIsEligible(book({ id: "b1", effectiveTo: new Date("2027-12-31") }), now)).toBe(true);
  });
});

// ═══ geographyMatch ═══

describe("geographyMatch — specificity scoring", () => {
  it("empty geography (wildcard) matches everything, score=0", () => {
    const r = geographyMatch({}, { circleCode: "C1", regionCode: "R1" });
    expect(r.matches).toBe(true);
    expect(r.score).toBe(0);
  });
  it("officeCode match = score 4", () => {
    const r = geographyMatch({ officeCode: "O1" }, { officeCode: "O1" });
    expect(r.matches).toBe(true);
    expect(r.score).toBe(4);
  });
  it("regionCode match = score 2", () => {
    const r = geographyMatch({ regionCode: "R1" }, { regionCode: "R1" });
    expect(r.matches).toBe(true);
    expect(r.score).toBe(2);
  });
  it("circleCode match = score 1", () => {
    const r = geographyMatch({ circleCode: "C1" }, { circleCode: "C1" });
    expect(r.matches).toBe(true);
    expect(r.score).toBe(1);
  });
  it("multi-level match = summed scores", () => {
    const r = geographyMatch({ officeCode: "O1", regionCode: "R1" }, { officeCode: "O1", regionCode: "R1" });
    expect(r.matches).toBe(true);
    expect(r.score).toBe(6); // 4 + 2
  });
  it("mismatch on any configured level = no match", () => {
    const r = geographyMatch({ regionCode: "R1" }, { regionCode: "R2" });
    expect(r.matches).toBe(false);
    expect(r.score).toBe(0);
  });
  it("query missing a level that book specifies = no match", () => {
    const r = geographyMatch({ officeCode: "O1" }, {});
    expect(r.matches).toBe(false);
  });
});

// ═══ resolveEffectivePrice — full resolution ═══

describe("resolveEffectivePrice — world-class resolution", () => {
  const books = [
    book({ id: "wildcard", geography: {}, effectiveFrom: new Date("2026-01-01") }),
    book({ id: "region-specific", geography: { regionCode: "R1" }, effectiveFrom: new Date("2026-03-01") }),
    book({ id: "office-specific", geography: { officeCode: "O1", regionCode: "R1" }, effectiveFrom: new Date("2026-06-01") }),
  ];
  const entries = [
    entry("wildcard", "prod-1", 100000n),
    entry("region-specific", "prod-1", 95000n),
    entry("office-specific", "prod-1", 90000n),
  ];

  it("most specific geography wins (office > region > wildcard)", () => {
    const result = resolveEffectivePrice(books, entries, { productId: "prod-1", segment: "govt", currency: "INR", geography: { officeCode: "O1", regionCode: "R1" } }, now);
    expect(result?.priceBookId).toBe("office-specific");
    expect(result?.amountMinor).toBe(90000n);
    expect(result?.specificity).toBe(6);
  });

  it("falls back to region when office not matched", () => {
    const result = resolveEffectivePrice(books, entries, { productId: "prod-1", segment: "govt", currency: "INR", geography: { regionCode: "R1" } }, now);
    expect(result?.priceBookId).toBe("region-specific");
    expect(result?.amountMinor).toBe(95000n);
  });

  it("falls back to wildcard when no geography match", () => {
    const result = resolveEffectivePrice(books, entries, { productId: "prod-1", segment: "govt", currency: "INR", geography: { regionCode: "R99" } }, now);
    expect(result?.priceBookId).toBe("wildcard");
  });

  it("null when no entry for product", () => {
    const result = resolveEffectivePrice(books, entries, { productId: "unknown", segment: "govt", currency: "INR" }, now);
    expect(result).toBeNull();
  });

  it("null when segment mismatch", () => {
    const result = resolveEffectivePrice(books, entries, { productId: "prod-1", segment: "private", currency: "INR" }, now);
    expect(result).toBeNull();
  });

  it("null when currency mismatch", () => {
    const result = resolveEffectivePrice(books, entries, { productId: "prod-1", segment: "govt", currency: "USD" }, now);
    expect(result).toBeNull();
  });

  it("tie-break: more recent effectiveFrom wins at same specificity", () => {
    const tiedBooks = [
      book({ id: "old", geography: {}, effectiveFrom: new Date("2026-01-01") }),
      book({ id: "new", geography: {}, effectiveFrom: new Date("2026-06-01") }),
    ];
    const tiedEntries = [entry("old", "prod-1", 100000n), entry("new", "prod-1", 100000n)];
    const result = resolveEffectivePrice(tiedBooks, tiedEntries, { productId: "prod-1", segment: "govt", currency: "INR" }, now);
    expect(result?.priceBookId).toBe("new");
  });

  it("final tie-break: lower amount wins (never overcharges)", () => {
    const tiedBooks = [
      book({ id: "expensive", geography: {}, effectiveFrom: new Date("2026-06-01") }),
      book({ id: "cheap", geography: {}, effectiveFrom: new Date("2026-06-01") }),
    ];
    const tiedEntries = [entry("expensive", "prod-1", 200000n), entry("cheap", "prod-1", 150000n)];
    const result = resolveEffectivePrice(tiedBooks, tiedEntries, { productId: "prod-1", segment: "govt", currency: "INR" }, now);
    expect(result?.priceBookId).toBe("cheap");
    expect(result?.amountMinor).toBe(150000n);
  });

  it("bigint comparison works above 2^53 (no floating point)", () => {
    const largeBooks = [book({ id: "b1", geography: {} })];
    const largeEntries = [entry("b1", "prod-1", 9007199254740993n)]; // > Number.MAX_SAFE_INTEGER
    const result = resolveEffectivePrice(largeBooks, largeEntries, { productId: "prod-1", segment: "govt", currency: "INR" }, now);
    expect(result?.amountMinor).toBe(9007199254740993n);
  });
});

// ═══ taxOnAmountMinor ═══

describe("taxOnAmountMinor — bigint tax computation", () => {
  it("18% GST = 1800 bps on ₹1000 = ₹180 (18000000 paise)", () => {
    expect(taxOnAmountMinor(100000000n, 1800)).toBe(18000000n); // 1000*100*1800/10000
  });
  it("5% = 500 bps on ₹500 = ₹25", () => {
    expect(taxOnAmountMinor(50000n, 500)).toBe(2500n);
  });
  it("0 bps = 0 tax", () => {
    expect(taxOnAmountMinor(100000n, 0)).toBe(0n);
  });
  it("truncates toward zero (no rounding up)", () => {
    // 100001 paise * 1800 / 10000 = 18000180/10000 = 18000.18 → truncated to 18000
    expect(taxOnAmountMinor(100001n, 1800)).toBe(18000n);
  });
  it("throws for non-integer bps", () => {
    expect(() => taxOnAmountMinor(100000n, 18.5)).toThrow("taxRateBps must be an integer");
  });
  it("works with large amounts (crores)", () => {
    // ₹10 crore = 1000000000 paise, 18% = 180000000 paise
    expect(taxOnAmountMinor(1000000000n, 1800)).toBe(180000000n);
  });
});
