import { describe, it, expect } from "vitest";
import { mapProcurementGRNSummaries } from "@/app/_data/apiMappers";
import { grnStatusLabel, isAwaitingInspection } from "./statusLabels";

// UAT Phase 2 C5: procurement stores a decided, partly-rejected GRN as `partial`
// (migration 0015 CHECK). The register used to fall back to "Draft" for it.
describe("GRN status `partial`", () => {
  it("maps to partially_rejected, never draft", () => {
    const rows = mapProcurementGRNSummaries([{ id: "g1", grnNo: "GRN/1", status: "partial" }]);
    expect(rows?.[0]?.status).toBe("partially_rejected");
  });

  it("reads as Partially Rejected and is not counted as awaiting inspection", () => {
    const status = mapProcurementGRNSummaries([{ id: "g1", grnNo: "GRN/1", status: "partial" }])?.[0]?.status ?? "";
    expect(grnStatusLabel(status)).toBe("Partially Rejected");
    expect(isAwaitingInspection(status)).toBe(false);
  });

  it("an unknown status still falls back to draft", () => {
    expect(mapProcurementGRNSummaries([{ id: "g1", grnNo: "GRN/1", status: "bogus" }])?.[0]?.status).toBe("draft");
  });
});
