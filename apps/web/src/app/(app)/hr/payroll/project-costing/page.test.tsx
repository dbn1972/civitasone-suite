import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const rolesMock = vi.fn(() => ["payroll_admin"]);
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => rolesMock(), getSessionUserId: () => "viewer-1" }));
vi.mock("@/app/_data/employeeNames", () => ({
  resolveEmployeeNames: vi.fn(async () => new Map([["e1", { name: "Asha Rao", employeeNo: "C-101" }]])),
  employeeDisplayLabel: (m: Map<string, { name: string }>, id: string, unknown: string) => m.get(id)?.name ?? unknown,
}));

import Page from "./page";

const P = "22222222-2222-4222-8222-222222222222";
function routeFetch(enabled = true) {
  fetchJsonMock.mockImplementation((url: string) => {
    if (url.includes("/settings")) return Promise.resolve({ data: { enabled }, source: "api" });
    if (url.includes("/allocations")) return Promise.resolve({ data: [
      { id: "a1", employeeId: "e1", targetType: "project", projectId: P, costCenterId: "c1", splitPct: "60.00", effectiveFrom: "2026-04-01", effectiveTo: null, status: "pending", requestedBy: "u9" },
    ], source: "api" });
    if (url.includes("/by-project")) return Promise.resolve({ data: [{ period: "2026-09", projectId: P, grossMinor: "1000000", employerCostMinor: "120000", totalCostMinor: "1120000", headcount: 4 }], source: "api" });
    if (url.includes("/by-cost-center")) return Promise.resolve({ data: { data: [], unallocated: [{ period: "2026-09", grossMinor: "500", employerCostMinor: "0", totalCostMinor: "500", headcount: 1 }] }, source: "api" });
    if (url.includes("/costing-index")) return Promise.resolve({ data: [{ projectId: P, code: "DIGILOCKER", name: "DigiLocker", costCenterId: "c1" }], source: "api" });
    return Promise.resolve({ data: [], source: "api" });
  });
}
async function renderPage(sp: { from?: string; to?: string } = { from: "2026-09", to: "2026-09" }) {
  const ui = await Page({ searchParams: Promise.resolve(sp) });
  render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

describe("Project costing page", () => {
  beforeEach(() => { fetchJsonMock.mockReset(); rolesMock.mockReturnValue(["payroll_admin"]); routeFetch(); });

  it("a project manager is turned away and nothing is fetched", async () => {
    rolesMock.mockReturnValue(["project_manager"]);
    await renderPage();
    expect(fetchJsonMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Cost by project")).not.toBeInTheDocument();
  });

  it("payroll admin sees the form, the allocations (with names) and the totals", async () => {
    await renderPage();
    expect(screen.getByText("Request a cost allocation")).toBeInTheDocument();
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
    expect(screen.getAllByText("DIGILOCKER — DigiLocker").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Approve allocation: Asha Rao 60%/ })).toBeInTheDocument();
    expect(screen.getByText("Not allocated")).toBeInTheDocument();
  });

  it("finance officer sees totals but no request form and no approve buttons", async () => {
    rolesMock.mockReturnValue(["finance_officer"]);
    await renderPage();
    expect(screen.queryByText("Request a cost allocation")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Approve allocation/ })).not.toBeInTheDocument();
    expect(screen.getByText("Cost by project")).toBeInTheDocument();
  });

  it("hr admin can request but is not shown cost totals (the API would refuse them)", async () => {
    rolesMock.mockReturnValue(["hr_admin"]);
    await renderPage();
    expect(screen.getByText("Request a cost allocation")).toBeInTheDocument();
    expect(screen.queryByText("Cost by project")).not.toBeInTheDocument();
    expect(fetchJsonMock.mock.calls.some(([u]) => String(u).includes("/by-project"))).toBe(false);
  });

  it("asks for a period before loading any report, and tells when costing is off", async () => {
    routeFetch(false);
    await renderPage({});
    expect(screen.getByText("Choose a period")).toBeInTheDocument();
    expect(fetchJsonMock.mock.calls.some(([u]) => String(u).includes("/by-project"))).toBe(false);
    expect(screen.getAllByText(/not switched on/).length).toBeGreaterThan(0);
  });
});
