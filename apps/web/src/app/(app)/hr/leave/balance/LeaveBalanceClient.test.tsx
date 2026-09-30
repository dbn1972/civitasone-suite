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

/**
 * A `Response` body can only be read once. `vi.fn().mockResolvedValue(x)`
 * hands every caller the SAME `x` instance, which is fine when only one
 * fetch happens per test -- but for an admin/manager role this component's
 * EntityPicker also calls `resolveEmployees` (its own `?ids=` lookup, to
 * pre-populate the picker's label for a preset value) in addition to the
 * leave-context fetch, so two independent `.json()` calls race for the same
 * Response and the second one throws ("body stream already read"),
 * surfacing as a spurious ErrorState. Routing per-URL and building a FRESH
 * Response per call avoids that entirely.
 */
function stubFetch(ctxBody: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/leave-context")) return jsonResponse(ctxBody);
      if (u.includes("/hrms/employees")) return jsonResponse([]);
      return jsonResponse({});
    }),
  );
}

function renderBalance() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <LeaveBalanceClient roles={["employee"]} myEmployeeId="emp-1" noLinkedProfile={false} profileSource="api" />
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
    // GAP-HR-LEAVE-BALANCE-03: the page-level "Total Used" stat card (a sum
    // of totalDays/balanceDays across leave TYPES with different semantics
    // -- EL, CL, HPL are not additive) was removed; this test used to also
    // assert its aggregate value ("3d") here, which no longer exists. The
    // fix for the negative-used bug this test is named for remains fully
    // covered by the per-allocation-row assertion above.
  });
});

/**
 * GAP-HR-LEAVE-BALANCE-02: HR/manager used to land on the first employee in
 * the roster (setEmpId(rows[0].id)) with zero indication of who was being
 * shown; a manager could never see their OWN balance by default either.
 */
describe("LeaveBalanceClient — no more blind employee preselection (GAP-HR-LEAVE-BALANCE-02)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("HR with no myEmployeeId and no ?empId=: shows the prompt, issues NO /leave-context request", async () => {
    stubFetch(CONTEXT);
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <LeaveBalanceClient roles={["hr_admin"]} myEmployeeId={null} noLinkedProfile={false} profileSource="api" />
      </NextIntlClientProvider>,
    );
    expect(await screen.findByText(/select an employee to view their balance/i)).toBeInTheDocument();
    await waitFor(() => {
      const ctxCalls = (fetch as ReturnType<typeof vi.fn>).mock.calls.filter((c) => String(c[0]).includes("/leave-context"));
      expect(ctxCalls).toHaveLength(0);
    });
  });

  it("manager WITH a linked employee record: sees their OWN balance by default, no picker interaction needed", async () => {
    stubFetch(CONTEXT);
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <LeaveBalanceClient roles={["manager"]} myEmployeeId="emp-1" noLinkedProfile={false} profileSource="api" />
      </NextIntlClientProvider>,
    );
    await waitFor(() => expect(screen.getByText("3 used")).toBeInTheDocument());
    const ctxCalls = (fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0])).filter((u) => u.includes("/leave-context"));
    expect(ctxCalls[0]).toContain("emp-1");
  });

  it("?empId= deep-link (initialEmployeeId prop): preselects that employee, not the caller's own record", async () => {
    stubFetch(CONTEXT);
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <LeaveBalanceClient roles={["hr_admin"]} myEmployeeId="emp-self" initialEmployeeId="emp-1" noLinkedProfile={false} profileSource="api" />
      </NextIntlClientProvider>,
    );
    await waitFor(() => expect(screen.getByText("3 used")).toBeInTheDocument());
    const ctxCalls = (fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0])).filter((u) => u.includes("/leave-context"));
    expect(ctxCalls[0]).toContain("emp-1");
    // The "view my own balance" quick-action must still be offered, since
    // the deep-link target isn't the caller's own record.
    expect(await screen.findByRole("button", { name: /view my own balance/i })).toBeInTheDocument();
  });
});

/**
 * GAP-HR-LEAVE-BALANCE-03: the "Allocate Leave" link in the empty state used
 * to render for every role, including managers who are denied on
 * /hr/leave/allocate (PermissionDenied).
 */
describe("LeaveBalanceClient — Allocate Leave link gated to HR roles (GAP-HR-LEAVE-BALANCE-03)", () => {
  const EMPTY_CONTEXT = { employee: CONTEXT.employee, leaveTypes: CONTEXT.leaveTypes, allocations: [] };
  beforeEach(() => stubFetch(EMPTY_CONTEXT));
  afterEach(() => vi.unstubAllGlobals());

  it("hr_admin sees the Allocate Leave link on an empty balance", async () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <LeaveBalanceClient roles={["hr_admin"]} myEmployeeId="emp-1" noLinkedProfile={false} profileSource="api" />
      </NextIntlClientProvider>,
    );
    expect(await screen.findByRole("link", { name: /allocate leave/i })).toBeInTheDocument();
  });

  it("a plain employee does NOT see the Allocate Leave link — sees a contact-HR message instead", async () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <LeaveBalanceClient roles={["employee"]} myEmployeeId="emp-1" noLinkedProfile={false} profileSource="api" />
      </NextIntlClientProvider>,
    );
    expect(await screen.findByText(/contact hr to get leave allocated/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /allocate leave/i })).not.toBeInTheDocument();
  });
});

/**
 * GAP-HR-LEAVE-BALANCE-04: a plain employee with no linked profile used to
 * see a blank page beyond the header -- no explanatory message at all.
 */
describe("LeaveBalanceClient — no-linked-profile / profile-error states (GAP-HR-LEAVE-BALANCE-04)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("no linked employee record: shows the honest 'contact HR' empty state, not a blank page", async () => {
    vi.stubGlobal("fetch", vi.fn());
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <LeaveBalanceClient roles={["employee"]} myEmployeeId={null} noLinkedProfile profileSource="api" />
      </NextIntlClientProvider>,
    );
    expect(await screen.findByText(/no employee record is linked to your account/i)).toBeInTheDocument();
  });

  it("a genuine profile-fetch failure shows an error state with retry, not the no-linked-profile message", async () => {
    vi.stubGlobal("fetch", vi.fn());
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <LeaveBalanceClient roles={["employee"]} myEmployeeId={null} noLinkedProfile={false} profileSource="error" />
      </NextIntlClientProvider>,
    );
    expect(await screen.findByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText(/no employee record is linked/i)).not.toBeInTheDocument();
  });
});
