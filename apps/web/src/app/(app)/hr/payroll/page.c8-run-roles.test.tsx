import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// UAT Phase 2 C8 (security, roles-11021730 R1): a finance officer opened
// /hr/payroll and saw every payroll run. The run screens now show "Access
// restricted" and never fetch runs for a role outside payroll staff + hr_admin.
const fetchJsonMock = vi.fn();
let roles: string[] = [];
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => roles,
  getSessionUserId: () => "u1",
  PAYROLL_ADMIN_ROLES: ["payroll_admin", "payroll_officer", "super_admin"],
  PAYROLL_READER_ROLES: ["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "finance_officer"],
  PAYROLL_REPORT_ROLES: ["payroll_admin", "payroll_officer", "super_admin", "hr_admin"],
}));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));

import PayrollPage from "./page";
import PayrollRunsPage from "./runs/page";
import PayrollRunDetailPage from "./[id]/page";

beforeEach(() => {
  fetchJsonMock.mockReset();
  fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
});

const fetchedRuns = () => fetchJsonMock.mock.calls.some(([p]) => typeof p === "string" && p.includes("/payroll/runs"));

describe("payroll run screens refuse finance roles", () => {
  for (const r of [["finance_officer"], ["finance_officer", "budget_officer"], ["finance_admin"]]) {
    it(`${r.join("+")}: /hr/payroll, /hr/payroll/runs and a run's page show Access restricted and fetch no runs`, async () => {
      roles = r;
      const { unmount } = render(await PayrollPage());
      expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
      unmount();
      const runs = render(await PayrollRunsPage());
      expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
      runs.unmount();
      render(await PayrollRunDetailPage({ params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }) }));
      expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
      expect(fetchedRuns()).toBe(false);
    });
  }
});
