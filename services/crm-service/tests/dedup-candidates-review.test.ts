/**
 * GAP-CRM-DEDUP-CANDIDATES-01 — the review payload masks PII at the source and
 * computes the differing fields on the CLEAR values. Pure: no database.
 */
import { describe, it, expect } from "vitest";
import { toReviewPair, type DedupCandidatePair } from "../src/modules/contacts/dedup-candidates-domain.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

function pair(left: Partial<DedupCandidatePair["left"]>, right: Partial<DedupCandidatePair["right"]>): DedupCandidatePair {
  const base = { name: "Priya Sharma", email: null, phone: null, company: "Nimbus", lastActivity: null };
  return {
    pairId: `${A}:${B}`,
    confidence: 80,
    matchedFields: ["name", "company"],
    left: { id: A, ...base, ...left },
    right: { id: B, ...base, ...right },
  };
}

describe("toReviewPair — masking", () => {
  const out = toReviewPair(
    pair(
      { email: "priya.sharma@nimbus.example", phone: "9876543210" },
      { email: "p.sharma@nimbus.example", phone: "9876543211" },
    ),
  );

  it("masks email and phone on both sides with the contacts module's canonical formats", () => {
    expect(out.left.email).toBe("p***@nimbus.example");
    expect(out.right.email).toBe("p***@nimbus.example");
    expect(out.left.phone).toBe("******3210");
    expect(out.right.phone).toBe("******3211");
  });

  it("never carries a clear email or phone anywhere in the serialised pair", () => {
    const json = JSON.stringify(out);
    for (const clear of ["priya.sharma@nimbus.example", "p.sharma@nimbus.example", "9876543210", "9876543211"]) {
      expect(json).not.toContain(clear);
    }
  });

  it("keeps name, company, ids, confidence and match reasons clear", () => {
    expect(out.left.name).toBe("Priya Sharma");
    expect(out.left.company).toBe("Nimbus");
    expect(out.left.id).toBe(A);
    expect(out.right.id).toBe(B);
    expect(out.confidence).toBe(80);
    expect(out.matchedFields).toEqual(["name", "company"]);
    expect(out.pairId).toBe(`${A}:${B}`);
  });

  it("leaves absent email/phone as null (nothing to mask, nothing invented)", () => {
    const none = toReviewPair(pair({}, {}));
    expect(none.left.email).toBeNull();
    expect(none.right.phone).toBeNull();
  });

  it("does not mutate the input pair", () => {
    const input = pair({ email: "a@b.example", phone: "9876543210" }, {});
    toReviewPair(input);
    expect(input.left.email).toBe("a@b.example");
    expect(input.left.phone).toBe("9876543210");
  });
});

describe("toReviewPair — diffFields are computed before masking", () => {
  it("flags two different phones that MASK IDENTICALLY (same last four digits)", () => {
    const out = toReviewPair(pair({ phone: "9876543210" }, { phone: "1112223210" }));
    expect(out.left.phone).toBe(out.right.phone);
    expect(out.diffFields).toContain("phone");
  });

  it("flags two different emails that mask identically (same first char + domain)", () => {
    const out = toReviewPair(pair({ email: "priya.sharma@nimbus.example" }, { email: "p.sharma@nimbus.example" }));
    expect(out.left.email).toBe(out.right.email);
    expect(out.diffFields).toContain("email");
  });

  it("does not flag fields that are equal ignoring case and surrounding whitespace", () => {
    const out = toReviewPair(
      pair(
        { name: "Priya Sharma", email: "Priya@Nimbus.example", company: "Nimbus " },
        { name: "priya sharma", email: "priya@nimbus.example", company: "nimbus" },
      ),
    );
    expect(out.diffFields).toEqual([]);
  });

  it("treats null and empty as the same (both absent)", () => {
    const out = toReviewPair(pair({ phone: null }, { phone: "" }));
    expect(out.diffFields).not.toContain("phone");
  });

  it("reports lastActivity and name differences too", () => {
    const out = toReviewPair(
      pair({ name: "Priya", lastActivity: "2026-07-01T10:00:00.000Z" }, { name: "Priyanka", lastActivity: "2026-07-05T10:00:00.000Z" }),
    );
    expect(out.diffFields).toEqual(expect.arrayContaining(["name", "lastActivity"]));
    expect(out.diffFields).not.toContain("company");
  });
});
