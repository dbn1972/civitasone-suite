import { describe, it, expect } from "vitest";
import { mapTravel, mapTravelTeam, type ApiTravelRow, type ApiTravelTeamRow } from "./mapTravel";

const BASE: ApiTravelRow = {
  id: "t1", purpose: "Field inspection", destination: "Pune", from_date: "2026-10-01", to_date: "2026-10-03",
  advance_required: 250000, mode: "rail", status: "pending", created_at: "2026-09-20T00:00:00Z",
  approved_by: null, approved_at: null, rejection_reason: null,
};

describe("mapTravel", () => {
  it("keeps the advance as paise (never rupees) and null when none was requested (GAP-HR-TRAVEL-02)", () => {
    expect(mapTravel([BASE])[0]!.advanceRequired).toBe(250000);
    expect(mapTravel([{ ...BASE, advance_required: null }])[0]!.advanceRequired).toBeNull();
    // zero is a real value, distinct from "none"
    expect(mapTravel([{ ...BASE, advance_required: 0 }])[0]!.advanceRequired).toBe(0);
  });

  it("only an approved request can be claimed as an expense (GAP-HR-TRAVEL-02)", () => {
    expect(mapTravel([{ ...BASE, status: "approved" }])[0]!.canClaim).toBe(true);
    for (const status of ["pending", "rejected", "cancelled"]) {
      expect(mapTravel([{ ...BASE, status }])[0]!.canClaim).toBe(false);
    }
  });

  it("surfaces the rejection reason for a rejected request, a dash otherwise (GAP-HR-TRAVEL-01)", () => {
    expect(mapTravel([{ ...BASE, status: "rejected", rejection_reason: "Budget exceeded" }])[0]!.rejectionReason).toBe("Budget exceeded");
    // the reject route stores "" when no reason was typed
    expect(mapTravel([{ ...BASE, status: "rejected", rejection_reason: "" }])[0]!.rejectionReason).toBe("—");
    expect(mapTravel([{ ...BASE, status: "pending", rejection_reason: null }])[0]!.rejectionReason).toBe("—");
    // a reason left on a row that is no longer rejected is not shown
    expect(mapTravel([{ ...BASE, status: "approved", rejection_reason: "stale" }])[0]!.rejectionReason).toBe("—");
  });
});

describe("mapTravelTeam", () => {
  const TEAM: ApiTravelTeamRow = { ...BASE, employee_id: "actor-1", employeeName: "Asha Verma" };

  it("keeps the requester's actor id so the UI can withhold decisions on the viewer's own request (GAP-HR-TRAVEL-01)", () => {
    const [row] = mapTravelTeam([TEAM]);
    expect(row!.employeeId).toBe("actor-1");
    expect(row!.employee).toBe("Asha Verma");
  });

  it("an unresolved requester name is 'Unknown employee', never the raw id", () => {
    const [row] = mapTravelTeam([{ ...TEAM, employeeName: undefined }]);
    expect(row!.employee).toBe("Unknown employee");
  });
});
