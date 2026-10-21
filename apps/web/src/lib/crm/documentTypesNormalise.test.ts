import { describe, it, expect } from "vitest";
import { normaliseDocumentType, normaliseDocumentTypes } from "./documents";

// GAP-CRM-DOCUMENT-TYPES-03: the list endpoint reports how many documents are
// filed under each type. "Not reported" must stay distinguishable from zero.
describe("normaliseDocumentType documentCount (GAP-CRM-DOCUMENT-TYPES-03)", () => {
  const base = { id: "t1", code: "pan", name: "PAN card", appliesTo: ["contact"] };

  it("keeps a reported count, including zero", () => {
    expect(normaliseDocumentType({ ...base, documentCount: 4 })?.documentCount).toBe(4);
    expect(normaliseDocumentType({ ...base, documentCount: 0 })?.documentCount).toBe(0);
  });

  it("reads the snake_case spelling too", () => {
    expect(normaliseDocumentType({ ...base, document_count: 2 })?.documentCount).toBe(2);
  });

  it("leaves it undefined (not zero) when the backend did not report it", () => {
    const t = normaliseDocumentType(base);
    expect(t).not.toBeNull();
    expect("documentCount" in t!).toBe(false);
  });

  it.each([["a string", "3"], ["a negative", -1], ["NaN", Number.NaN], ["null", null]])(
    "ignores %s rather than inventing a count",
    (_label, value) => {
      expect(normaliseDocumentType({ ...base, documentCount: value })?.documentCount).toBeUndefined();
    },
  );

  it("normalises a whole list", () => {
    const rows = normaliseDocumentTypes({ data: [{ ...base, documentCount: 1 }, { ...base, id: "t2", code: "gst" }] });
    expect(rows.map((r) => r.documentCount)).toEqual([1, undefined]);
  });
});
