import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
const rolesMock = vi.fn(() => ["payroll_admin"]);
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => rolesMock(),
  PAYROLL_ADMIN_ROLES: ["payroll_admin", "payroll_officer", "super_admin"],
  PAYROLL_READER_ROLES: ["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "finance_officer"],
}));

import CostingPage from "./page";

const CC_ID = "11111111-2222-3333-4444-555555555555";
const UNKNOWN_CC = "99999999-8888-7777-6666-555555555555";

type Routes = { report?: unknown; reportSource?: "api" | "error"; rules?: unknown[]; rulesSource?: "api" | "error"; centers?: unknown[] };
function routeFetch(r: Routes) {
  fetchJsonMock.mockImplementation((url: string) => {
    if (url.includes("/costing/report")) return Promise.resolve({ data: r.report ?? [], source: r.reportSource ?? "api" });
    if (url.includes("/costing/rules")) return Promise.resolve({ data: r.rules ?? [], source: r.rulesSource ?? "api" });
    if (url.includes("/finance/cost-centers")) return Promise.resolve({ data: r.centers ?? [], source: "api" });
    return Promise.resolve({ data: [], source: "api" });
  });
}

async function renderPage(searchParams: { period?: string }) {
  const ui = await CostingPage({ searchParams });
  render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

describe("CostingPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    rolesMock.mockReturnValue(["payroll_admin"]);
    routeFetch({});
  });

  it("prompts for a period when none is given, without fetching the report or showing zero stats (COSTING-03)", async () => {
    await renderPage({});
    expect(screen.getByText("Choose a period")).toBeInTheDocument();
    expect(fetchJsonMock.mock.calls.some(([u]) => String(u).includes("/costing/report"))).toBe(false);
    // StatCard renders null as an em dash -- never a real-looking 0.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
  });

  it("shows the real cost-centre code and name, never a fabricated CC-xxxx code (COSTING-01)", async () => {
    routeFetch({
      report: [
        { employeeGroup: "Group A", costCenterId: CC_ID, splitPct: 60, allocatedMinor: "500000" },
        { employeeGroup: "Group B", costCenterId: UNKNOWN_CC, splitPct: 40, allocatedMinor: "100" },
      ],
      centers: [{ id: CC_ID, code: "CC-REV-01", name: "Revenue Wing" }],
    });
    await renderPage({ period: "2026-07" });
    expect(screen.getAllByText("CC-REV-01 — Revenue Wing").length).toBeGreaterThan(0);
    expect(screen.getByText(`Unresolved (id ${UNKNOWN_CC})`)).toBeInTheDocument();
    expect(screen.queryByText("CC-11111111")).not.toBeInTheDocument();
    // COSTING-06: split shown with a % sign.
    expect(screen.getByText("60%")).toBeInTheDocument();
  });

  it("lists rules with a per-group total and flags groups that don't add up to 100% (COSTING-02)", async () => {
    routeFetch({
      rules: [
        { id: "r1", employeeGroup: "Teachers", costCenterId: CC_ID, splitPct: 60, status: "active" },
        { id: "r2", employeeGroup: "Teachers", costCenterId: UNKNOWN_CC, splitPct: 30, status: "active" },
      ],
      centers: [{ id: CC_ID, code: "CC-1", name: "Schools" }],
    });
    await renderPage({});
    expect(screen.queryByText("Rules list not yet available")).not.toBeInTheDocument();
    expect(screen.getAllByText("90% (must be 100%)").length).toBe(2);
    expect(screen.getByText(/do not add up to 100%: Teachers/)).toBeInTheDocument();
  });

  it("keeps the period form visible when the report fails (COSTING-04)", async () => {
    routeFetch({ reportSource: "error" });
    await renderPage({ period: "2026-07" });
    expect(screen.getByText("We couldn't load costing.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Period \(YYYY-MM\)/)).toBeInTheDocument();
  });

  it("rejects an out-of-range month in the URL without calling the report API (COSTING-06)", async () => {
    await renderPage({ period: "2026-13" });
    expect(screen.getByText(/"2026-13" is not a valid period/)).toBeInTheDocument();
    expect(fetchJsonMock.mock.calls.some(([u]) => String(u).includes("/costing/report"))).toBe(false);
  });

  it("denies employee sessions without fetching anything (COSTING-05)", async () => {
    rolesMock.mockReturnValue(["employee"]);
    await renderPage({ period: "2026-07" });
    expect(screen.getByText("Access restricted")).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("hides the create-rule form from read-only roles (COSTING-05)", async () => {
    rolesMock.mockReturnValue(["finance_officer"]);
    await renderPage({});
    expect(screen.queryByText("Create Costing Rule")).not.toBeInTheDocument();
    rolesMock.mockReturnValue(["payroll_officer"]);
    await renderPage({});
    expect(screen.getByText("Create Costing Rule")).toBeInTheDocument();
  });
});
