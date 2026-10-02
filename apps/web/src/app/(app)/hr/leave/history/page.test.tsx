import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

import LeaveHistoryClient from "./LeaveHistoryClient";

const EMPLOYEES = [{ id: "emp-1", name: "Asha Verma", employeeNo: "E001" }];

// UX-017 (tranche 2): LeaveHistoryPage now reads its copy through next-intl
// (useTranslations("leaveHistory")), so it needs a real provider in the tree
// — same pattern as citizen/grievances/GrievancesTable.test.tsx.
//
// GAP-HR-LEAVE-HISTORY-04: HR/manager no longer auto-lands on the first
// employee in the roster (that was the bug this item fixes — see
// LeaveHistoryClient.tsx's own comment on the removed `setEmpId(rows[0].id)`
// call), so every test below now explicitly selects "emp-1" after render,
// the same way a real HR user would, instead of relying on the old
// silent auto-select to put data on screen.
async function renderPage() {
  const utils = render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <LeaveHistoryClient roles={["hr_admin"]} myEmployeeId={null} noLinkedProfile={false} profileSource="api" />
    </NextIntlClientProvider>,
  );
  const select = await screen.findByLabelText("Employee");
  fireEvent.change(select, { target: { value: "emp-1" } });
  return utils;
}

function mockFetch(apps: unknown[], opts: { employeesOk?: boolean; appsOk?: boolean } = {}) {
  const { employeesOk = true, appsOk = true } = opts;
  return vi.fn(async (url: string) => {
    if (url.includes("/hrms/employees")) {
      return {
        ok: employeesOk,
        status: employeesOk ? 200 : 500,
        json: async () => (employeesOk ? EMPLOYEES : { code: "INTERNAL" }),
      } as Response;
    }
    if (url.includes("/hrms/leave/applications")) {
      return {
        ok: appsOk,
        status: appsOk ? 200 : 500,
        json: async () => (appsOk ? { data: apps } : { code: "INTERNAL" }),
      } as Response;
    }
    if (url.endsWith("/cancel")) {
      return { ok: true, status: 202, text: async () => "{}" } as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  });
}

describe("LeaveHistoryPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requires confirmation before cancelling a leave application", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([{ id: "app-1", leaveType: "Casual Leave", fromDate: "2026-09-01", toDate: "2026-09-02", status: "pending" }]),
    );
    await renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText(/cancel this leave application/i)).toBeInTheDocument();
    // The actual cancel request must not fire until confirmed.
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(calls.some((u: string) => u.endsWith("/cancel"))).toBe(false);
  });

  it("also offers Cancel for an already-approved application (backend allows it, the button didn't)", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([{ id: "app-2", leaveType: "Earned Leave", fromDate: "2026-09-01", toDate: "2026-09-05", status: "approved" }]),
    );
    await renderPage();
    expect(await screen.findByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("does not offer Cancel for a rejected application", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([{ id: "app-3", leaveType: "Casual Leave", fromDate: "2026-09-01", toDate: "2026-09-02", status: "rejected" }]),
    );
    await renderPage();
    await screen.findByText("Casual Leave");
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it("shows an error state instead of a false empty state when the history fetch fails", async () => {
    vi.stubGlobal("fetch", mockFetch([], { appsOk: false }));
    await renderPage();
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/couldn't load leave history/i);
    });
    // Must not silently render as "no applications" for what is actually a fetch failure.
    expect(screen.queryByText(/no leave applications/i)).not.toBeInTheDocument();
  });
});

/**
 * UX-016: cancelling an application used to throw the raw backend response
 * text (falling back to `Cancel failed (${res.status})`) verbatim — the
 * same class of leak useFormError closes fleet-wide (UX-003).
 */
describe("LeaveHistoryPage — UX-016 clerk-safe errors", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows a clerk-safe message, never the raw server text or status, when cancelling fails", async () => {
    const APP = {
      id: "app1",
      employeeName: "Test Employee",
      leaveTypeName: "Earned Leave",
      fromDate: "2026-09-10",
      toDate: "2026-09-11",
      daysApplied: 2,
      status: "pending",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/hrms/employees")) return { ok: true, status: 200, json: async () => [EMPLOYEES[0]] } as Response;
        if (url.includes("/hrms/leave/applications")) return { ok: true, status: 200, json: async () => ({ data: [APP] }) } as Response;
        if (init?.method === "PATCH") return new Response("leave-service: cancel-route trace at line 55", { status: 500 });
        return { ok: false, status: 404, json: async () => ({}) } as Response;
      }),
    );

    // renderPage(), not a bare render(): LeaveHistoryPage calls
    // useTranslations() (UX-017) and needs a NextIntlClientProvider ancestor
    // — this test predates that requirement (added by UX-016 tranche 2
    // against a pre-i18n version of the page).
    await renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /^cancel$/i }));
    const dialog = await screen.findByRole("alertdialog");
    // GAP-HR-LEAVE-HISTORY-04: renderPage()'s hr_admin has no linked
    // employee record of their own (myEmployeeId: null), so every cancel
    // they make counts as "on someone else's behalf" and now requires a
    // reason -- type one so Confirm is enabled, same as a real admin would.
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Employee requested withdrawal by phone" } });
    fireEvent.click(screen.getByRole("button", { name: /cancel leave/i }));

    // Scoped to the dialog's own error region (role="alert"), not the whole
    // dialog's textContent -- which also now includes the reason field's
    // "N/500 characters" counter (GAP-HR-LEAVE-HISTORY-04's maxReasonLength),
    // an unrelated, coincidental "500" that isn't the leaked HTTP status
    // this assertion cares about.
    const errorRegion = await within(dialog).findByRole("alert");
    await waitFor(() => expect(errorRegion).toHaveTextContent(/couldn't save/i));
    expect(errorRegion.textContent).not.toMatch(/leave-service/);
    expect(errorRegion.textContent).not.toMatch(/\b500\b/);
  });
});

/**
 * GAP-HR-LEAVE-HISTORY-04: HR/manager used to default to the first employee
 * in the roster (arbitrary order for HR; first direct report for a
 * manager), showing someone's leave history — and letting a manager cancel
 * their approved leave — before any deliberate selection.
 */
describe("LeaveHistoryClient — no more blind employee preselection (GAP-HR-LEAVE-HISTORY-04)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("HR with no myEmployeeId: shows the select prompt, issues NO /leave/applications request until an employee is chosen", async () => {
    vi.stubGlobal("fetch", mockFetch([{ id: "app-1", leaveType: "Casual Leave", fromDate: "2026-09-01", toDate: "2026-09-02", status: "pending" }]));
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <LeaveHistoryClient roles={["hr_admin"]} myEmployeeId={null} noLinkedProfile={false} profileSource="api" />
      </NextIntlClientProvider>,
    );
    // The select renders with only the prompt option until explicitly changed.
    await screen.findByLabelText("Employee");
    await waitFor(() => {
      const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
      expect(calls.some((u) => u.includes("/leave/applications"))).toBe(false);
    });
  });

  it("manager WITH a linked employee record: sees their OWN history by default, no picker interaction needed", async () => {
    vi.stubGlobal("fetch", mockFetch([{ id: "app-1", leaveType: "Casual Leave", fromDate: "2026-09-01", toDate: "2026-09-02", status: "pending" }]));
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <LeaveHistoryClient roles={["manager"]} myEmployeeId="emp-1" noLinkedProfile={false} profileSource="api" />
      </NextIntlClientProvider>,
    );
    await screen.findByText("Casual Leave");
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.includes("/leave/applications?empId=emp-1"))).toBe(true);
  });
});

/**
 * GAP-HR-LEAVE-HISTORY-01: stat tiles used to render real 0s while loading
 * or after a failed fetch (rather than an honest "—"), and "Total" counted
 * every row the client happened to have fetched -- not a real, server-side
 * total across the employee's full history.
 */
describe("LeaveHistoryClient — honest stat tiles, real total (GAP-HR-LEAVE-HISTORY-01)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("tiles show '—' before any employee is selected, never a real 0", async () => {
    vi.stubGlobal("fetch", mockFetch([]));
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <LeaveHistoryClient roles={["hr_admin"]} myEmployeeId={null} noLinkedProfile={false} profileSource="api" />
      </NextIntlClientProvider>,
    );
    await screen.findByLabelText("Employee");
    const tiles = screen.getAllByText("—");
    expect(tiles.length).toBeGreaterThan(0);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("Active Applications tile uses the server's real total (excluding cancelled/draft), not just the loaded page's row count", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes("/hrms/employees")) return { ok: true, status: 200, json: async () => EMPLOYEES } as Response;
        if (u.includes("/hrms/leave/applications")) {
          return {
            ok: true, status: 200,
            json: async () => ({
              data: [{ id: "app-1", leaveTypeName: "Casual Leave", fromDate: "2026-09-01", toDate: "2026-09-02", status: "approved" }],
              meta: { total: 9, statusCounts: { approved: 5, pending: 2, rejected: 1, cancelled: 1 } },
            }),
          } as Response;
        }
        return { ok: false, status: 404, json: async () => ({}) } as Response;
      }),
    );
    await renderPage();
    // Active Applications = total(9) - cancelled(1) - draft(0) = 8, NOT the
    // single row actually returned in `data`.
    await waitFor(() => expect(screen.getByText("8")).toBeInTheDocument());
    expect(screen.getByText("5")).toBeInTheDocument(); // Approved tile
  });
});

/**
 * GAP-HR-LEAVE-HISTORY-05: "draft" is cancellable but had no chip label or
 * style at all, so it rendered as the raw word "draft" in the default grey.
 */
describe("LeaveHistoryClient — draft status label (GAP-HR-LEAVE-HISTORY-05)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("a draft application renders the translated 'Draft' label, not the raw status word", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([{ id: "app-1", leaveTypeName: "Casual Leave", fromDate: "2026-09-01", toDate: "2026-09-02", status: "draft" }]),
    );
    await renderPage();
    expect(await screen.findByText("Draft")).toBeInTheDocument();
    expect(screen.queryByText("draft")).not.toBeInTheDocument();
  });
});

/**
 * GAP-HR-LEAVE-HISTORY-02: hand-rolled <table> had no sort/filter and
 * truncated the Reason column with no way to read the rest.
 */
describe("LeaveHistoryClient — DataTable sort/filter/reason (GAP-HR-LEAVE-HISTORY-02)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("filters rows by typing into the table's filter box", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        { id: "app-1", leaveTypeName: "Casual Leave", fromDate: "2026-09-01", toDate: "2026-09-02", status: "pending", reason: "medical appointment" },
        { id: "app-2", leaveTypeName: "Earned Leave", fromDate: "2026-09-05", toDate: "2026-09-06", status: "approved", reason: "family function" },
      ]),
    );
    await renderPage();
    await screen.findByText("Casual Leave");
    expect(screen.getByText("Earned Leave")).toBeInTheDocument();

    const filterBox = screen.getByPlaceholderText(/filter|search/i);
    fireEvent.change(filterBox, { target: { value: "medical" } });
    await waitFor(() => {
      expect(screen.getByText("Casual Leave")).toBeInTheDocument();
      expect(screen.queryByText("Earned Leave")).not.toBeInTheDocument();
    });
  });

  it("the full reason text is available via the cell's title attribute, not hard-truncated with no way to read it", async () => {
    const LONG_REASON = "Attending a family medical emergency that requires travel out of state for several days";
    vi.stubGlobal(
      "fetch",
      mockFetch([{ id: "app-1", leaveTypeName: "Casual Leave", fromDate: "2026-09-01", toDate: "2026-09-02", status: "pending", reason: LONG_REASON }]),
    );
    await renderPage();
    const reasonCell = await screen.findByTitle(LONG_REASON);
    expect(reasonCell).toHaveTextContent(LONG_REASON);
  });
});
