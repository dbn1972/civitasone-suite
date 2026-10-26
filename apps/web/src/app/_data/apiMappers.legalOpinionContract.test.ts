import { describe, it, expect } from "vitest";
import { mapLegalOpinionSummaries } from "./apiMappers";

/**
 * GAP-LEGAL-OPINIONS-04 contract: legal-service returns ONE row shape
 * (soughtBy / counselName) from both GET /v1/legal/opinions and
 * GET /v1/legal/opinions/:id. The list screen reads the mapped
 * requestedBy/advisorName; the detail page reads the raw soughtBy/counselName
 * (with aliases). For the same server row both must resolve to the same
 * requester and counsel, so neither screen shows a blank the other fills.
 */
const detailField = (data: Record<string, unknown>, ...keys: string[]): string => {
  // Mirrors field() in app/(app)/legal/opinions/[id]/page.tsx.
  for (const key of keys) {
    const v = data[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return "—";
};

describe("legal opinion list/detail DTO contract", () => {
  const serverRow = {
    id: "op-77",
    opinionNo: "OPN/2026/0077",
    subject: "Land acquisition",
    soughtBy: "R. Sharma",
    counselName: "Adv. K. Rao",
    status: "drafted",
  };

  it("list and detail resolve the same requester and counsel for one server row", () => {
    const [listed] = mapLegalOpinionSummaries({ items: [serverRow] })!;
    const detailCounsel = detailField(serverRow, "counselName", "counsel_name", "advisorName");
    const detailSoughtBy = detailField(serverRow, "soughtBy", "sought_by", "requestedBy");
    expect(listed.advisorName).toBe(detailCounsel);
    expect(listed.requestedBy).toBe(detailSoughtBy);
    expect(detailCounsel).toBe("Adv. K. Rao");
    expect(detailSoughtBy).toBe("R. Sharma");
  });

  it("neither screen invents a name when the server row has none", () => {
    const bare = { id: "op-78", opinionNo: "OPN/2026/0078", subject: "S", status: "sought" };
    const [listed] = mapLegalOpinionSummaries({ items: [bare] })!;
    expect(listed.advisorName).toBeUndefined();
    expect(detailField(bare, "counselName", "counsel_name", "advisorName")).toBe("—");
  });
});
