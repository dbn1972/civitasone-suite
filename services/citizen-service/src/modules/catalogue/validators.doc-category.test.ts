import { describe, it, expect } from "vitest";
import { updateDefinitionBody } from "./validators.js";

// Owner decision D4c #8 (GAP-DESIGNER-DETAIL-B6-03): a required document may carry
// the id of its DPDP-classified catalogue category. The schema used to strip it.
describe("requiredDocuments categoryId", () => {
  it("accepts and preserves a document category id", () => {
    const parsed = updateDefinitionBody.parse({
      requiredDocuments: [{ docType: "aadhaar_copy", mandatory: true, categoryId: "aadhaar_copy" }],
    });
    expect(parsed.requiredDocuments?.[0]?.categoryId).toBe("aadhaar_copy");
  });

  it("still accepts a document with no category (free-text Other)", () => {
    const parsed = updateDefinitionBody.parse({ requiredDocuments: [{ docType: "rent", mandatory: true }] });
    expect(parsed.requiredDocuments?.[0]?.categoryId).toBeUndefined();
  });
});
