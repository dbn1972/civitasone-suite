import { describe, it, expect } from "vitest";
import { documentsWithWarnings } from "./documentBuilderApi";

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
});
