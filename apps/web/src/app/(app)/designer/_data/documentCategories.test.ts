import { describe, it, expect } from "vitest";
import { DOCUMENT_CATEGORIES, documentCategoryById } from "@/app/_components/ds/designer/documentTypes";
import { documentsApiToUi, documentsUiToApi } from "./documentBuilderApi";
import { documentsReviewSummary } from "./documentBuilderModel";

/** Owner decision D4c #8 (GAP-DESIGNER-DETAIL-B6-03): DPO-classified document catalogue. */
describe("document category catalogue (draft starter list, DPO to confirm)", () => {
  it("ships the four starter categories, each flagged for DPO confirmation", () => {
    expect(DOCUMENT_CATEGORIES.map((c) => c.id)).toEqual([
      "aadhaar_copy", "income_certificate", "caste_certificate", "residence_certificate",
    ]);
    for (const c of DOCUMENT_CATEGORIES) {
      expect(c.dpoConfirmed).toBe(false);
      expect(c.labels.en).toBeTruthy();
      expect(c.labels.hi).toBeTruthy();
    }
  });
  it("classifies Aadhaar and caste documents as sensitive", () => {
    expect(documentCategoryById("aadhaar_copy")?.sensitivity).toBe("sensitive");
    expect(documentCategoryById("caste_certificate")?.sensitivity).toBe("sensitive");
    expect(documentCategoryById("unknown")).toBeNull();
  });
  it("gives each category one docType, so two documents of a category share it", () => {
    const ids = DOCUMENT_CATEGORIES.map((c) => c.docType);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("categoryId round-trips through the API mapping", () => {
  const row = {
    id: "1", docType: "aadhaar_copy", categoryId: "aadhaar_copy",
    labels: { en: "Aadhaar copy", hi: "आधार प्रति" }, formats: ["pdf" as const], maxSizeMb: 5,
    mandatory: true, verifiedAtLane: "",
  };
  it("saves categoryId in the requiredDocuments payload", () => {
    expect(documentsUiToApi([row])[0]?.categoryId).toBe("aadhaar_copy");
  });
  it("omits categoryId for a free-text (Other) document", () => {
    expect(documentsUiToApi([{ ...row, categoryId: "" }])[0]).not.toHaveProperty("categoryId", "");
    expect(documentsUiToApi([{ ...row, categoryId: undefined }])[0]?.categoryId).toBeUndefined();
  });
  it("reads categoryId back, and older documents load with none", () => {
    expect(documentsApiToUi([{ docType: "aadhaar_copy", mandatory: true, categoryId: "aadhaar_copy" }])[0]?.categoryId).toBe("aadhaar_copy");
    expect(documentsApiToUi([{ docType: "rent", mandatory: true }])[0]?.categoryId).toBe("");
  });
});

describe("documentsReviewSummary", () => {
  it("counts classified documents next to the mandatory ones", () => {
    expect(documentsReviewSummary([{ mandatory: true, categoryId: "aadhaar_copy" }, { mandatory: false }])).toBe(
      "2 document requirement(s) · 1 mandatory · 1 classified",
    );
    expect(documentsReviewSummary([{ mandatory: false }])).toBe("1 document requirement(s)");
  });
});
