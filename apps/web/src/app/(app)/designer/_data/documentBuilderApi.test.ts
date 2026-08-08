import { describe, it, expect } from "vitest";
import { documentsUiToApi, documentsWithWarnings } from "./documentBuilderApi";

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
});
