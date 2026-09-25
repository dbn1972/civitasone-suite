import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

import LeaveBalanceClient from "./LeaveBalanceClient";

/**
 * HIGH fix regression test: the Leave Balance page showed impossible
 * negative numbers (e.g. "Total Used: -4d" observed live) because it used
 * the leave TYPE's generic policy cap (maxDays) as the "days used"
 * denominator instead of this EMPLOYEE's actual granted allocation
 * (totalDays) -- which can legitimately exceed the generic cap (pro-rated,
 * carried-forward, or HR-adjusted).
 *
 * This exact scenario is the one this fix's live verification also drove
 * through a real running hrms-service + Postgres: an EL allocation with
 * totalDays=35 (> the type's maxDays=30) and balanceDays=32. Old code:
 * "used = maxDays(30) - balanceDays(32) = -2" (impossible negative). Fixed
 * code: "used = totalDays(35) - balanceDays(32) = 3" (correct).
 */
const CONTEXT = {
  employee: { id: "emp-1", employeeNo: "VERIFY001", name: "Verify Employee" },
  leaveTypes: [
    { id: "lt-cl", code: "CL", name: "Casual Leave", maxDays: 8 },
    { id: "lt-el", code: "EL", name: "Earned Leave", maxDays: 30 },
  ],
  allocations: [
    { id: "alloc-cl", leaveTypeId: "lt-cl", leaveTypeCode: "CL", leaveTypeName: "Casual Leave", fy: "2026-27", totalDays: 8, balanceDays: 8 },
    { id: "alloc-el", leaveTypeId: "lt-el", leaveTypeCode: "EL", leaveTypeName: "Earned Leave", fy: "2026-27", totalDays: 35, balanceDays: 32 },
  ],
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function renderBalance() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <LeaveBalanceClient roles={["employee"]} myEmployeeId="emp-1" />
    </NextIntlClientProvider>,
  );
}

describe("LeaveBalanceClient", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(jsonResponse(CONTEXT));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("uses the employee's actual allocation (totalDays), never the type's generic policy cap, as the denominator", async () => {
    renderBalance();

    // EL row's "usedSuffix" ({count} used): totalDays(35) - balanceDays(32)
    // = 3 -- never negative, and never maxDays(30) - balanceDays(32) = -2.
    await waitFor(() => expect(screen.getByText("3 used")).toBeInTheDocument());
    expect(screen.queryByText(/^-\d+ used$/)).not.toBeInTheDocument();

    // Page-level "Total Used" stat card: sum of totalDays (8 + 35 = 43)
    // minus sum of balanceDays (8 + 32 = 40) = 3 -- same fix applied to the
    // aggregate, rendered as "3d".
    expect(screen.getByText("3d")).toBeInTheDocument();
  });
});
