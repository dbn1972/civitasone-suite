import { describe, it, expect } from "vitest";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";
import kn from "@/messages/kn.json";
import ta from "@/messages/ta.json";
import te from "@/messages/te.json";

// GAP-HR-APAR-05: DoPT/SPARROW names the officer chain Reporting Officer ->
// Reviewing Officer -> Accepting Authority. "Counter-signing Officer" was a
// third, competing name for the middle stage (it survived in apar.subtitle
// after the card and detail labels were fixed), so no locale may carry it.
function collectStrings(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") out.push(node);
  else if (node && typeof node === "object") for (const v of Object.values(node)) collectStrings(v, out);
  return out;
}

describe("APAR terminology (GAP-HR-APAR-05)", () => {
  const locales = { en, hi, kn, ta, te } as const;

  for (const [name, messages] of Object.entries(locales)) {
    it(`${name}.json has no 'Counter-signing' (or its Hindi transliteration) in any string`, () => {
      const offenders = collectStrings(messages).filter((s) => /counter[-\s]?sign|काउंटर[-\s]?हस्ताक्षर/i.test(s));
      expect(offenders).toEqual([]);
    });
  }

  it("the list subtitle, card and detail page all name the middle stage 'Reviewing Officer'", () => {
    expect(en.apar.subtitle).toContain("Reviewing Officer");
    expect(en.aparFlowCard.stageReviewing).toBe("Reviewing Officer");
    expect(en.aparDetail.stageReviewingOfficer).toContain("Reviewing Officer");
    expect(en.apar.subtitle).toContain("Accepting Authority");
    expect(en.aparFlowCard.stageAccepting).toBe("Accepting Authority");
    expect(en.aparDetail.stageAcceptingAuthority).toContain("Accepting Authority");
  });

  it("the grouped in-review stat is named for what it counts (stages 2-4), not the old 'Under Review'", () => {
    expect(en.apar.statInOfficerReview).toBe("In Officer Review");
    expect((en.apar as Record<string, string>).statUnderReview).toBeUndefined();
    expect((hi.apar as Record<string, string>).statUnderReview).toBeUndefined();
  });
});
