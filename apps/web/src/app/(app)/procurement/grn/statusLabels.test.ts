import { describe, it, expect } from "vitest";
import {
  grnStatusLabel,
  isAwaitingInspection,
  matchState,
  MATCH_LABELS,
  MATCH_PILL_STATUS,
  MATCH_STATUS_LABELS,
} from "./statusLabels";
import { mapProcurementGRNDetail } from "@/app/_data/apiMappers";

describe("GRN status labels (GAP-PROCUREMENT-GRN-01)", () => {
  it("labels under_inspection instead of showing the raw snake_case string", () => {
    expect(grnStatusLabel("under_inspection")).toBe("Under Inspection");
    expect(grnStatusLabel("quality_check")).toBe("Quality Check");
  });

  it("counts every pre-decision state as awaiting inspection", () => {
    for (const s of ["draft", "under_inspection", "received", "quality_check"]) {
      expect(isAwaitingInspection(s)).toBe(true);
    }
    for (const s of ["accepted", "rejected", "partially_rejected"]) {
      expect(isAwaitingInspection(s)).toBe(false);
    }
  });
});

describe("GRN match state (GAP-PROCUREMENT-GRN-04 / GRN-DETAIL-02)", () => {
  it("treats undefined as a neutral pending state, not a mismatch", () => {
    expect(matchState(undefined)).toBe("pending");
    expect(matchState(true)).toBe("matched");
    expect(matchState(false)).toBe("mismatch");
  });

  it("maps each state to a coloured pill with a text label (never colour-only)", () => {
    expect(MATCH_PILL_STATUS.pending).toBe("pending");
    expect(MATCH_PILL_STATUS.matched).toBe("accepted");
    expect(MATCH_PILL_STATUS.mismatch).toBe("rejected");
    expect(MATCH_LABELS.pending).toBe("Pending");
    expect(MATCH_STATUS_LABELS.pending).toBe("Pending");
    expect(MATCH_STATUS_LABELS.accepted).toBe("Matched");
    expect(MATCH_STATUS_LABELS.rejected).toBe("Mismatch");
  });
});

describe("mapProcurementGRNDetail threeWayMatch (GAP-PROCUREMENT-GRN-DETAIL-02)", () => {
  const base = {
    id: "11111111-1111-4111-8111-111111111111",
    grnNo: "GRN/2026/0001",
    poRef: "procurement_po:abc",
    vendor: "Acme",
    receivedDate: "2026-09-01",
    status: "under_inspection",
    items: [],
  };

  it("leaves threeWayMatch undefined when the payload omits it (not coerced to false)", () => {
    const d = mapProcurementGRNDetail(base);
    expect(d?.threeWayMatch).toBeUndefined();
  });

  it("keeps a real boolean when the payload provides one", () => {
    expect(mapProcurementGRNDetail({ ...base, threeWayMatch: false, status: "rejected" })?.threeWayMatch).toBe(false);
    expect(mapProcurementGRNDetail({ ...base, threeWayMatch: true, status: "accepted" })?.threeWayMatch).toBe(true);
  });

  it("maps createdBy for the self-inspection pre-emption (GAP-PROCUREMENT-GRN-DETAIL-03)", () => {
    const d = mapProcurementGRNDetail({ ...base, createdBy: "user-1" });
    expect(d?.createdBy).toBe("user-1");
  });
});
