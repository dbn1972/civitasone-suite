import { describe, it, expect } from "vitest";
import { documentsApiToUi, documentsUiToApi, documentsWithWarnings } from "./documentBuilderApi";

describe("documentBuilderApi", () => {
  it("warns when mandatory doc has no verifying lane", () => {
    const rows = documentsWithWarnings(
      [{
        id: "1",
        docType: "rent",
        labels: { en: "Rent agreement", hi: "" },
        formats: ["pdf"],
        maxSizeMb: 5,
        mandatory: true,
        verifiedAtLane: "",
      }],
      ["inspection"],
    );
    expect(rows[0]?.warning).toMatch(/no verifying lane/i);
  });

  it("maps UI documents to API payload with verifiedAtLane", () => {
    const api = documentsUiToApi([
      {
        id: "1",
        docType: "rent_agreement",
        labels: { en: "Rent agreement", hi: "किराया समझौता" },
        formats: ["pdf"],
        maxSizeMb: 5,
        mandatory: true,
        verifiedAtLane: "inspection",
      },
    ]);
    expect(api[0]).toMatchObject({
      docType: "rent_agreement",
      label: "Rent agreement",
      labels: { en: "Rent agreement", hi: "किराया समझौता" },
      verifiedAtLane: "inspection",
      mandatory: true,
    });
  });

  // GAP-DESIGNER-DETAIL-B6-02: an Odia label is saved and reloaded unchanged.
  it("round-trips a non-en/hi locale label unchanged", () => {
    const api = documentsUiToApi([
      {
        id: "1",
        docType: "rent_agreement",
        labels: { en: "Rent agreement", hi: "", or: "ଭଡ଼ା ଚୁକ୍ତିନାମା" },
        formats: ["pdf"],
        maxSizeMb: 5,
        mandatory: true,
        verifiedAtLane: "",
      },
    ]);
    expect(api[0]?.labels).toMatchObject({ or: "ଭଡ଼ା ଚୁକ୍ତିନାମା" });
    const ui = documentsApiToUi(api);
    expect(ui[0]?.labels.or).toBe("ଭଡ଼ା ଚୁକ୍ତିନାମା");
    expect(ui[0]?.labels.en).toBe("Rent agreement");
  });

  it("loads a legacy en/hi-only document with missing locales defaulting to empty", () => {
    const ui = documentsApiToUi([{ docType: "pan", labels: { en: "PAN" }, mandatory: true }]);
    expect(ui[0]?.labels).toMatchObject({ en: "PAN", hi: "" });
    expect(ui[0]?.labels.or ?? "").toBe("");
  });
});
