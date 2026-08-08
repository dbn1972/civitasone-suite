import { describe, it, expect } from "vitest";
import { formatNumberingPreview } from "./issuanceTypes";

describe("formatNumberingPreview", () => {
  it("joins prefix, ward, year, and sequence tokens", () => {
    const preview = formatNumberingPreview([
      { kind: "prefix", value: "TL" },
      { kind: "ward" },
      { kind: "year" },
      { kind: "seq", seqWidth: 5 },
    ]);
    expect(preview).toMatch(/^TL\/W12\/\d{4}\/00041$/);
  });
});
