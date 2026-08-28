import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import LeaveHistoryPage from "./page";

const EMPLOYEES = [{ id: "emp-1", name: "Asha Verma", employeeNo: "E001" }];

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
    render(<LeaveHistoryPage />);
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
    render(<LeaveHistoryPage />);
    expect(await screen.findByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("does not offer Cancel for a rejected application", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([{ id: "app-3", leaveType: "Casual Leave", fromDate: "2026-09-01", toDate: "2026-09-02", status: "rejected" }]),
    );
    render(<LeaveHistoryPage />);
    await screen.findByText("Casual Leave");
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it("shows an error state instead of a false empty state when the history fetch fails", async () => {
    vi.stubGlobal("fetch", mockFetch([], { appsOk: false }));
    render(<LeaveHistoryPage />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/failed to load leave history/i);
    });
    // Must not silently render as "no applications" for what is actually a fetch failure.
    expect(screen.queryByText(/no leave applications/i)).not.toBeInTheDocument();
  });
});
