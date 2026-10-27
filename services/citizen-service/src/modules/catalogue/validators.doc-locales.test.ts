import { describe, it, expect } from "vitest";
import { updateDefinitionBody } from "./validators.js";

// GAP-DESIGNER-DETAIL-B6-02: requiredDocuments must carry labels for any
// tenant locale (e.g. Odia "or"), not only en/hi.
describe("requiredDocuments locale labels", () => {
  it("accepts and preserves a non-en/hi locale label", () => {
    const parsed = updateDefinitionBody.parse({
      requiredDocuments: [
        { docType: "rent_agreement", mandatory: true, labels: { en: "Rent agreement", or: "ଭଡ଼ା ଚୁକ୍ତିନାମା" } },
      ],
    });
    expect(parsed.requiredDocuments?.[0]?.labels).toEqual({ en: "Rent agreement", or: "ଭଡ଼ା ଚୁକ୍ତିନାମା" });
  });
});
