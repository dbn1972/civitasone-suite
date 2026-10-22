import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const getEmployeeByIdMock = vi.fn();
vi.mock("../../../../_data/loaders", () => ({ getEmployeeById: (...a: unknown[]) => getEmployeeByIdMock(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
let mockRoles: string[] = [];
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => mockRoles,
  PAYROLL_READER_ROLES: ["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "finance_officer"],
}));

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));

import EmployeeDetailPage from "./page";

const EMP = {
  id: "e1", employeeId: "EMP001", name: "Priya Sharma", department: "Finance", designation: "Section Officer",
  joiningDate: "2020-01-15", status: "confirmed", bankAccountNo: null, bankIfsc: null, pan: null,
};

type Rows = unknown[] | "error" | "reject";

/** Routes the page's lifecycle reads: per-kind rows, or a soft error / hard rejection. */
function mockLifecycle(opts: { transfers?: Rows; promotions?: Rows; deputation?: Rows }) {
  fetchJsonMock.mockImplementation(async (url: string, fallback: unknown, o?: { mapResponse?: (p: unknown) => unknown }) => {
    const pick = url.includes("/lifecycle/transfers") ? opts.transfers
      : url.includes("/lifecycle/promotions") ? opts.promotions
      : url.includes("/hrms/deputation") ? opts.deputation
      : undefined;
    if (pick === undefined) return { data: fallback, source: "api" };
    if (pick === "reject") throw new Error("boom");
    if (pick === "error") return { data: fallback, source: "error" };
    return { data: o?.mapResponse?.({ data: pick }) ?? fallback, source: "api" };
  });
}

async function renderPage(roles: string[], employee: Record<string, unknown> = EMP) {
  mockRoles = roles;
  getEmployeeByIdMock.mockResolvedValue({ data: employee, source: "api" });
  const ui = await EmployeeDetailPage({ params: { id: "e1" } });
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

const lifecycleCalls = () => fetchJsonMock.mock.calls.map(([u]) => String(u)).filter((u) => /lifecycle|deputation/.test(u));

describe("EmployeeDetailPage lifecycle timeline (GAP-HR-EMPLOYEES-DETAIL-01)", () => {
  beforeEach(() => { getEmployeeByIdMock.mockReset(); fetchJsonMock.mockReset(); });

  it("asks each lifecycle list for this employee only", async () => {
    mockLifecycle({ transfers: [], promotions: [], deputation: [] });
    await renderPage(["hr_admin"]);
    const calls = lifecycleCalls();
    expect(calls).toHaveLength(3);
    expect(calls.every((u) => u.endsWith("?employeeId=e1"))).toBe(true);
  });

  it("shows an explicit 'unavailable' alert when every lifecycle read fails -- not a clean history", async () => {
    mockLifecycle({ transfers: "error", promotions: "error", deputation: "error" });
    await renderPage(["hr_admin"]);
    expect(screen.getByRole("alert")).toHaveTextContent("couldn't be loaded right now");
    // The profile's own join entry is still shown beneath the warning.
    expect(screen.getByText("Joined Organisation")).toBeInTheDocument();
  });

  it("treats a rejected read the same as a soft error", async () => {
    mockLifecycle({ transfers: "reject", promotions: [], deputation: [] });
    await renderPage(["hr_admin"]);
    expect(screen.getByRole("alert")).toHaveTextContent("couldn't be loaded right now");
  });

  it("flags a single failed read but still renders the events that did load", async () => {
    mockLifecycle({
      transfers: [{ id: "t1", status: "ordered", employeeId: "e1", toDepartmentName: "Treasury", fromDepartmentName: "Finance", effectiveDate: "2024-04-01" }],
      promotions: [],
      deputation: "error",
    });
    await renderPage(["hr_admin"]);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Transfer → Treasury")).toBeInTheDocument();
  });

  it("shows no alert when all three reads succeed", async () => {
    mockLifecycle({
      transfers: [{ id: "t1", status: "ordered", employeeId: "e1", toDepartmentName: "Treasury", effectiveDate: "2024-04-01" }],
      promotions: [{ id: "p1", status: "approved", employeeId: "e1", toDesignationName: "Under Secretary", effectiveDate: "2025-01-01" }],
      deputation: [{ id: "d1", status: "active", employeeId: "e1", deputationOrg: "NIC", fromDate: "2025-06-01" }],
    });
    await renderPage(["hr_admin"]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Transfer → Treasury")).toBeInTheDocument();
    expect(screen.getByText("Promoted to Under Secretary")).toBeInTheDocument();
    expect(screen.getByText("Deputed to NIC")).toBeInTheDocument();
  });

  it("never renders another employee's transfer / promotion / deputation, even if the backend returned them", async () => {
    mockLifecycle({
      transfers: [
        { id: "t1", status: "ordered", employeeId: "e1", toDepartmentName: "Treasury", effectiveDate: "2024-04-01" },
        { id: "t2", status: "ordered", employeeId: "someone-else", toDepartmentName: "Cabinet Secretariat", effectiveDate: "2024-05-01" },
      ],
      promotions: [{ id: "p2", status: "approved", employeeId: "someone-else", toDesignationName: "Joint Secretary", effectiveDate: "2025-01-01" }],
      deputation: [{ id: "d2", status: "active", employeeId: "someone-else", deputationOrg: "PMO", fromDate: "2025-06-01" }],
    });
    await renderPage(["hr_admin"]);
    expect(screen.getByText("Transfer → Treasury")).toBeInTheDocument();
    expect(screen.queryByText(/Cabinet Secretariat/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Joint Secretary/)).not.toBeInTheDocument();
    expect(screen.queryByText(/PMO/)).not.toBeInTheDocument();
  });

  it("does not request the HR-only lifecycle lists for a manager (and so never shows a false 'unavailable')", async () => {
    mockLifecycle({ transfers: "error", promotions: "error", deputation: "error" });
    await renderPage(["manager"]);
    expect(lifecycleCalls()).toHaveLength(0);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("EmployeeDetailPage status presentation (GAP-HR-EMPLOYEES-DETAIL-06)", () => {
  beforeEach(() => { getEmployeeByIdMock.mockReset(); fetchJsonMock.mockReset(); mockLifecycle({ transfers: [], promotions: [], deputation: [] }); });

  const pillFor = (text: string) => screen.getByText(text, { selector: ".pill" });

  it("renders an on_leave employee's pill as a warning, humanized, with an explanatory note", async () => {
    await renderPage(["hr_admin"], { ...EMP, status: "on_leave" });
    expect(pillFor("On Leave")).toHaveClass("warn");
    expect(screen.getByRole("note")).toHaveTextContent(/is on leave/i);
    expect(screen.queryByText(/on_leave/)).not.toBeInTheDocument();
    // Self-service links stay; the HR lifecycle actions are withheld.
    expect(screen.getByRole("link", { name: /view attendance/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /initiate transfer/i })).not.toBeInTheDocument();
  });

  it("shows the on_leave explanation to a manager too (it explains why HR actions are absent)", async () => {
    await renderPage(["manager"], { ...EMP, status: "on_leave" });
    expect(screen.getByRole("note")).toHaveTextContent(/is on leave/i);
  });

  it("keeps the shared colours for the other statuses (suspended bad, deputation info)", async () => {
    await renderPage(["hr_admin"], { ...EMP, status: "suspended" });
    expect(pillFor("Suspended")).toHaveClass("bad");
  });

  it("keeps deputation as an info pill", async () => {
    await renderPage(["hr_admin"], { ...EMP, status: "deputation" });
    expect(pillFor("Deputation")).toHaveClass("info");
  });

  it("explains a no_show employee's missing actions without a raw underscore", async () => {
    await renderPage(["hr_admin"], { ...EMP, status: "no_show" });
    const note = screen.getByText(/Actions are unavailable while the employee's status is/);
    expect(note).toHaveTextContent("Actions are unavailable while the employee's status is no show.");
    expect(note.textContent).not.toMatch(/_/);
    expect(pillFor("No Show")).toHaveClass("bad");
  });

  it("explains a suspended employee's missing actions in plain words", async () => {
    await renderPage(["hr_admin"], { ...EMP, status: "suspended" });
    expect(screen.getByText("Actions are unavailable while the employee's status is suspended.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Quick Actions" })).not.toBeInTheDocument();
  });

  it("never renders any canonical status with an underscore", async () => {
    for (const status of ["probation", "confirmed", "on_leave", "suspended", "deputation", "retired", "separated", "terminated", "no_show"]) {
      const { unmount } = await renderPage(["hr_admin"], { ...EMP, status });
      expect(document.body.textContent ?? "").not.toMatch(/[a-z]_[a-z]/);
      unmount();
    }
  });
});
