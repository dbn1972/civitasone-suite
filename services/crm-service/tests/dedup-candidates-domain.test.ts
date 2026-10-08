/**
 * GAP2-CRM-DEDUP-CANDIDATES-07 — pure pair-computation tests.
 */
import { describe, it, expect } from "vitest";
import { computeDedupPairs, pairIdOf, type DedupPairInput } from "../src/modules/contacts/dedup-candidates-domain.js";
import { DEFAULT_DEDUP_RULES } from "../src/modules/contacts/dedup-domain.js";

function c(id: string, over: Partial<DedupPairInput> = {}): DedupPairInput {
  return { id, name: null, email: null, phone: null, company: null, gstin: null, pan: null, ...over };
}

describe("pairIdOf", () => {
  it("is order independent", () => {
    expect(pairIdOf("b", "a")).toBe(pairIdOf("a", "b"));
    expect(pairIdOf("a", "b")).toBe("a:b");
  });
});

describe("computeDedupPairs", () => {
  const rules = DEFAULT_DEDUP_RULES;

  it("flags a near-duplicate pair on matching name + company", () => {
    const pairs = computeDedupPairs(
      [
        c("11111111-1111-4111-8111-111111111111", { name: "Ravi Kumar", company: "Acme Corp" }),
        c("22222222-2222-4222-8222-222222222222", { name: "Ravi Kumar", company: "Acme Corp" }),
        c("33333333-3333-4333-8333-333333333333", { name: "Totally Different", company: "Other Ltd" }),
      ],
      rules,
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.confidence).toBeGreaterThan(0);
    expect(pairs[0]!.matchedFields).toContain("name");
  });

  it("excludes dismissed pairs", () => {
    const a = "11111111-1111-4111-8111-111111111111";
    const b = "22222222-2222-4222-8222-222222222222";
    const pairs = computeDedupPairs(
      [c(a, { name: "Ravi Kumar", company: "Acme" }), c(b, { name: "Ravi Kumar", company: "Acme" })],
      rules,
      { dismissed: new Set([pairIdOf(a, b)]) },
    );
    expect(pairs).toHaveLength(0);
  });

  it("returns pairs highest-confidence first", () => {
    const pairs = computeDedupPairs(
      [
        c("11111111-1111-4111-8111-111111111111", { name: "Same Name", company: "Same Co" }),
        c("22222222-2222-4222-8222-222222222222", { name: "Same Name", company: "Same Co" }),
        c("33333333-3333-4333-8333-333333333333", { name: "Same Name", company: "Nope" }),
      ],
      rules,
    );
    expect(pairs.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < pairs.length; i++) {
      expect(pairs[i - 1]!.confidence).toBeGreaterThanOrEqual(pairs[i]!.confidence);
    }
  });
});
