import { describe, it, expect } from "vitest";
import { mapProcurementIndentDetail } from "./apiMappers";

describe("mapProcurementIndentDetail approvalTrailAvailable (GAP-PROCUREMENT-INDENTS-DETAIL-05)", () => {
  const base = { id: "i1", indentNo: "IND-1", department: "Stores", status: "approved", totalMinor: "100", requestedBy: "X" };
  it("flags an unreachable decision source only when the API says so explicitly", () => {
    expect(mapProcurementIndentDetail({ ...base, approvalTrail: [], approvalTrailAvailable: false })!.approvalTrailAvailable).toBe(false);
    expect("approvalTrailAvailable" in mapProcurementIndentDetail({ ...base, approvalTrail: [], approvalTrailAvailable: true })!).toBe(false);
    expect("approvalTrailAvailable" in mapProcurementIndentDetail({ ...base, approvalTrail: [] })!).toBe(false);
  });
  it("maps decision steps (actor, action, timestamp, reason)", () => {
    const d = mapProcurementIndentDetail({ ...base, approvalTrail: [{ actor: "Asha", action: "Rejected", timestamp: "2026-10-01T05:00:00.000Z", remarks: "Over budget" }] })!;
    expect(d.approvalTrail).toEqual([{ actor: "Asha", action: "Rejected", timestamp: "2026-10-01T05:00:00.000Z", remarks: "Over budget" }]);
  });
});
