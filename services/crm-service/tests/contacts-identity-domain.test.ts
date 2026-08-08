/**
 * CRM Contacts — identity resolution and dedup domain tests.
 * Pack #08. Source: modules/contacts/identity-domain.ts, dedup-domain.ts
 */
import { describe, it, expect } from "vitest";
import { normalizePhone, normalizeEmail, normalizeGstin, normalizePan, matchScore, businessIdMatches } from "../src/modules/contacts/identity-domain.js";
import { scoreCandidate, rankDuplicates, DEFAULT_DEDUP_RULES } from "../src/modules/contacts/dedup-domain.js";

describe("normalizePhone", () => {
  it("strips spaces/dashes", () => expect(normalizePhone("+91 98765-43210")).toBe("+919876543210"));
  it("strips leading 0 for 11-digit Indian numbers", () => expect(normalizePhone("09876543210")).toBe("9876543210"));
  it("preserves +", () => expect(normalizePhone("+1234567890")).toBe("+1234567890"));
  it("strips parens and leading 0 (11-digit Indian)", () => expect(normalizePhone("(022) 12345678")).toBe("2212345678"));
});

describe("normalizeEmail", () => {
  it("lowercases", () => expect(normalizeEmail("John@EXAMPLE.COM")).toBe("john@example.com"));
  it("strips dots for gmail", () => expect(normalizeEmail("j.o.h.n@gmail.com")).toBe("john@gmail.com"));
  it("strips +suffix for gmail", () => expect(normalizeEmail("john+tag@gmail.com")).toBe("john@gmail.com"));
  it("preserves dots for non-gmail", () => expect(normalizeEmail("j.doe@company.com")).toBe("j.doe@company.com"));
  it("trims whitespace", () => expect(normalizeEmail("  a@b.com  ")).toBe("a@b.com"));
});

describe("normalizeGstin / normalizePan", () => {
  it("uppercases and trims GSTIN", () => expect(normalizeGstin(" 27aabcu9603r1zm ")).toBe("27AABCU9603R1ZM"));
  it("uppercases and trims PAN", () => expect(normalizePan(" abcde1234f ")).toBe("ABCDE1234F"));
});

describe("matchScore — fuzzy token overlap", () => {
  it("exact match = 100", () => expect(matchScore("John Doe", "John Doe")).toBe(100));
  it("partial overlap", () => expect(matchScore("John Doe", "John Smith")).toBe(50));
  it("no overlap = 0", () => expect(matchScore("Alice", "Bob")).toBe(0));
  it("empty = 0", () => expect(matchScore("", "anything")).toBe(0));
});

describe("businessIdMatches", () => {
  it("matches on GSTIN", () => expect(businessIdMatches({ gstin: "27AABCU9603R1ZM" }, { gstin: "27aabcu9603r1zm" })).toBe("gstin"));
  it("matches on PAN", () => expect(businessIdMatches({ pan: "ABCDE1234F" }, { pan: "abcde1234f" })).toBe("pan"));
  it("null when no match", () => expect(businessIdMatches({ gstin: "A" }, { gstin: "B" })).toBeNull());
  it("null when fields missing", () => expect(businessIdMatches({}, {})).toBeNull());
});

describe("scoreCandidate — dedup scoring", () => {
  it("exact email match scores weight points", () => {
    const candidate = { email: "a@b.com" };
    const other = { id: "c1", email: "a@b.com" };
    const result = scoreCandidate(candidate, other, DEFAULT_DEDUP_RULES);
    expect(result.score).toBeGreaterThan(0);
    expect(result.matchedFields).toContain("email");
  });

  it("no match = score 0", () => {
    const result = scoreCandidate({ email: "x@y.com" }, { id: "c1", email: "z@w.com" }, DEFAULT_DEDUP_RULES);
    expect(result.score).toBe(0);
  });

  it("score capped at 100", () => {
    const rules = [
      { field: "email" as const, matchType: "exact" as const, weight: 60, threshold: 100, enabled: true },
      { field: "phone" as const, matchType: "exact" as const, weight: 60, threshold: 100, enabled: true },
    ];
    const result = scoreCandidate({ email: "a@b.com", phone: "1234567890" }, { id: "c1", email: "a@b.com", phone: "1234567890" }, rules);
    expect(result.score).toBe(100); // capped
  });
});

describe("rankDuplicates — sorted by score", () => {
  it("returns highest score first", () => {
    const candidate = { email: "a@b.com", name: "John Doe" };
    const others = [
      { id: "c1", name: "Jane Smith" },
      { id: "c2", email: "a@b.com", name: "John Doe" },
    ];
    const ranked = rankDuplicates(candidate, others, DEFAULT_DEDUP_RULES);
    expect(ranked[0]!.id).toBe("c2");
    expect(ranked[0]!.score).toBeGreaterThan(0);
  });

  it("excludes zero-score matches", () => {
    const ranked = rankDuplicates({ email: "unique@x.com" }, [{ id: "c1", email: "other@y.com" }], DEFAULT_DEDUP_RULES);
    expect(ranked.length).toBe(0);
  });

  it("respects limit", () => {
    const others = Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, email: "a@b.com" }));
    const ranked = rankDuplicates({ email: "a@b.com" }, others, DEFAULT_DEDUP_RULES, 5);
    expect(ranked.length).toBe(5);
  });
});
