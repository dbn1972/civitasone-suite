import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

import LeaveHistoryClient from "./LeaveHistoryClient";

const EMPLOYEES = [{ id: "emp-1", name: "Asha Verma", employeeNo: "E001" }];

// UX-017 (tranche 2): LeaveHistoryPage now reads its copy through next-intl
// (useTranslations("leaveHistory")), so it needs a real provider in the tree
// — same pattern as citizen/grievances/GrievancesTable.test.tsx.
function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <LeaveHistoryClient roles={["hr_admin"]} myEmployeeId={null} />
    </NextIntlClientProvider>,
  );
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
    renderPage();
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
    renderPage();
    expect(await screen.findByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("does not offer Cancel for a rejected application", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([{ id: "app-3", leaveType: "Casual Leave", fromDate: "2026-09-01", toDate: "2026-09-02", status: "rejected" }]),
    );
    renderPage();
    await screen.findByText("Casual Leave");
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it("shows an error state instead of a false empty state when the history fetch fails", async () => {
    vi.stubGlobal("fetch", mockFetch([], { appsOk: false }));
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/couldn.t load this leave history/i);
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
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /^cancel$/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: /cancel leave/i }));

    await waitFor(() => expect(dialog).toHaveTextContent(/couldn't save/i));
    expect(dialog.textContent).not.toMatch(/leave-service/);
    expect(dialog.textContent).not.toMatch(/\b500\b/);
  });
});
