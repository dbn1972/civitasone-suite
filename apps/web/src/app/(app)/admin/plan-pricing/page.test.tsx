import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

let mockRoles: string[] = [];
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => mockRoles, getSessionTenantId: () => "t1", getSessionUserId: () => "u1" }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/admin/plan-pricing" }));
const listMock = vi.fn();
const modsMock = vi.fn();
const quoteMock = vi.fn();
vi.mock("@/app/_data/planPricingLoaders", () => ({
  getPlanList: (...a: unknown[]) => listMock(...a),
  getPlanModules: (...a: unknown[]) => modsMock(...a),
  getPlanQuote: (...a: unknown[]) => quoteMock(...a),
}));

import PlanPricingPage from "./page";

describe("admin plan pricing page (M6)", () => {
  beforeEach(() => { listMock.mockReset(); modsMock.mockReset(); quoteMock.mockReset(); mockRoles = ["platform_admin"]; });

  it("shows plan modules (with the ones added automatically) and price with GST separate", async () => {
    listMock.mockResolvedValue({ data: [{ id: "p1", code: "hr_payroll", name: "HR with Payroll" }], source: "api", status: 200 });
    modsMock.mockResolvedValue({ data: { planId: "p1", planCode: "hr_payroll", source: "catalogue_modules", selected: ["payroll"], pulledIn: ["employee"], moduleIds: ["employee", "payroll"] }, source: "api" });
    quoteMock.mockResolvedValue({ data: { onDate: "2026-11-11", billingCycle: "annual", lines: [], totals: { netMinor: "1200000", gstMinor: "216000", grossMinor: "1416000" } }, source: "api" });
    render(await PlanPricingPage());
    expect(screen.getByText("HR with Payroll (hr_payroll)")).toBeInTheDocument();
    expect(screen.getByText("Payroll & Salary")).toBeInTheDocument();
    expect(screen.getByText("Employee Master (HRIS)")).toBeInTheDocument();
    expect(screen.getByText("₹12,000.00")).toBeInTheDocument();
    expect(screen.getByText("₹2,160.00")).toBeInTheDocument();
    expect(screen.getByText("₹14,160.00")).toBeInTheDocument();
    expect(screen.getByText("cycle.annual")).toBeInTheDocument();
  });

  it("a plan with no price yet says so instead of inventing one", async () => {
    listMock.mockResolvedValue({ data: [{ id: "p2", code: "new", name: "New" }], source: "api", status: 200 });
    modsMock.mockResolvedValue({ data: null, source: "api" });
    quoteMock.mockResolvedValue({ data: null, source: "api", status: 404 });
    render(await PlanPricingPage());
    expect(screen.getByText("noPrice")).toBeInTheDocument();
  });

  it("a failed load is an error state, never an empty list", async () => {
    listMock.mockResolvedValue({ data: [], source: "error", status: 502 });
    render(await PlanPricingPage());
    expect(screen.queryByText("empty.title")).not.toBeInTheDocument();
  });

  it("a non-platform role sees access restricted and nothing is fetched", async () => {
    mockRoles = ["tenant_admin"];
    render(await PlanPricingPage());
    expect(listMock).not.toHaveBeenCalled();
  });
});
