/**
 * DQ-001 — configurable duplicate-detection scorer (pure).
 */
import { describe, it, expect } from "vitest";
import {
  scoreCandidate,
  rankDuplicates,
  DEFAULT_DEDUP_RULES,
  type DedupRule,
  type DedupCandidate,
} from "../src/modules/contacts/dedup-domain.js";
import { businessIdMatches, normalizeGstin } from "../src/modules/contacts/identity-domain.js";

const RULES = [...DEFAULT_DEDUP_RULES];

describe("scoreCandidate", () => {
  it("scores an exact email match", () => {
    const m = scoreCandidate(
      { email: "jane@acme.com" },
      { id: "a", email: "JANE@acme.com" },
      RULES,
    );
    expect(m.matchedFields).toContain("email");
    expect(m.score).toBe(40);
  });

  it("scores an exact GSTIN match (case-insensitive)", () => {
    const m = scoreCandidate(
      { gstin: "29abcde1234f1z5" },
      { id: "a", gstin: "29ABCDE1234F1Z5" },
      RULES,
    );
    expect(m.matchedFields).toContain("gstin");
    expect(m.score).toBe(50);
  });

  it("scores an exact PAN match", () => {
    const m = scoreCandidate({ pan: "abcde1234f" }, { id: "a", pan: "ABCDE1234F" }, RULES);
    expect(m.matchedFields).toContain("pan");
  });

  it("scores a normalized phone match", () => {
    const m = scoreCandidate(
      { phone: "+91 98765-43210" },
      { id: "a", phone: "9876543210" },
      RULES,
    );
    expect(m.matchedFields).toContain("phone");
  });

  it("accumulates multiple matched fields and caps at 100", () => {
    const m = scoreCandidate(
      { email: "j@acme.com", gstin: "29ABCDE1234F1Z5", name: "Jane Doe", company: "Acme Corp" },
      { id: "a", email: "j@acme.com", gstin: "29ABCDE1234F1Z5", name: "Jane Doe", company: "Acme Corp" },
      RULES,
    );
    expect(m.score).toBe(100); // 40+50+20+15 capped
    expect(m.matchedFields).toEqual(expect.arrayContaining(["email", "gstin", "name", "company"]));
  });

  it("fuzzy name match respects the threshold", () => {
    const strict: DedupRule[] = [
      { field: "name", matchType: "fuzzy", weight: 20, threshold: 60, enabled: true },
    ];
    expect(scoreCandidate({ name: "Jane Doe" }, { id: "a", name: "Jane Doe" }, strict).score).toBe(20);
    expect(scoreCandidate({ name: "Jane Doe" }, { id: "a", name: "Bob Smith" }, strict).score).toBe(0);
  });

  it("ignores disabled rules", () => {
    const disabled: DedupRule[] = [
      { field: "email", matchType: "exact", weight: 40, threshold: 100, enabled: false },
    ];
    expect(scoreCandidate({ email: "a@b.com" }, { id: "a", email: "a@b.com" }, disabled).score).toBe(0);
  });

  it("no match when fields are absent", () => {
    expect(scoreCandidate({ email: null }, { id: "a", email: null }, RULES).score).toBe(0);
  });
});

describe("rankDuplicates", () => {
  const candidates: DedupCandidate[] = [
    { id: "no-match", name: "Zoe", email: "zoe@x.com" },
    { id: "email-match", name: "J", email: "jane@acme.com" },
    { id: "strong", name: "Jane Doe", email: "jane@acme.com", gstin: "29ABCDE1234F1Z5" },
  ];

  it("returns only positive scores, highest first", () => {
    const out = rankDuplicates(
      { name: "Jane Doe", email: "jane@acme.com", gstin: "29ABCDE1234F1Z5" },
      candidates,
      RULES,
    );
    expect(out[0]!.id).toBe("strong");
    expect(out.map((m) => m.id)).not.toContain("no-match");
    expect(out.every((m) => m.score > 0)).toBe(true);
  });

  it("honours the limit", () => {
    const out = rankDuplicates(
      { email: "jane@acme.com" },
      candidates,
      RULES,
      1,
    );
    expect(out).toHaveLength(1);
  });

  it("returns empty when nothing matches", () => {
    expect(rankDuplicates({ email: "nobody@nowhere.com" }, candidates, RULES)).toEqual([]);
  });
});

describe("businessIdMatches (identity-domain)", () => {
  it("detects a shared GSTIN", () => {
    expect(businessIdMatches({ gstin: "29abcde1234f1z5" }, { gstin: "29ABCDE1234F1Z5" })).toBe("gstin");
  });
  it("detects a shared PAN", () => {
    expect(businessIdMatches({ pan: "abcde1234f" }, { pan: "ABCDE1234F" })).toBe("pan");
  });
  it("returns null when neither matches", () => {
    expect(businessIdMatches({ gstin: "x" }, { gstin: "y" })).toBeNull();
  });
  it("normalizeGstin upper-cases", () => {
    expect(normalizeGstin(" 29abcde1234f1z5 ")).toBe("29ABCDE1234F1Z5");
  });
});
