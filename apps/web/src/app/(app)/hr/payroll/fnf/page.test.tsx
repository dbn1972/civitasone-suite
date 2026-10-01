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
const getSessionRolesMock = vi.fn(() => ["payroll_admin"]);
vi.mock("@/lib/auth/roleGuard", async (io) => ({
  ...(await io<typeof import("@/lib/auth/roleGuard")>()),
  getSessionRoles: () => getSessionRolesMock(),
}));

import FnfPage from "./page";

const EMP = "9b8c7d6e-0000-4000-8000-000000000001";

async function renderPage() {
  const ui = await FnfPage();
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

describe("FnfPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    getSessionRolesMock.mockReturnValue(["payroll_admin"]);
  });

  it("GAP-PAYROLL-FNF-05: a card shows the employee name, HR code, translated separation type and an Indian-format date -- never the UUID", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [{ id: "s1", employeeId: EMP, employeeName: "Meera Iyer", employeeCode: "EMP-0451", separationType: "retirement", separationDate: "2026-07-01", netPayableMinor: "500000", status: "draft" }],
      source: "api",
    });
    const { container } = await renderPage();
    expect(screen.getByText("Meera Iyer")).toBeInTheDocument();
    expect(screen.getByText((_, node) => node?.textContent === "EMP-0451 · Retirement · 01 Jul 2026")).toBeInTheDocument();
    expect(container.textContent).not.toContain(EMP);
  });

  it("GAP-PAYROLL-FNF-05: an unresolved employee reads 'Unknown employee', not the UUID", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [{ id: "s1", employeeId: EMP, employeeName: null, employeeCode: null, separationType: "vrs", separationDate: "2026-07-01", netPayableMinor: "500000", status: "draft" }],
      source: "api",
    });
    const { container } = await renderPage();
    expect(screen.getByText("Unknown employee")).toBeInTheDocument();
    expect(container.textContent).not.toContain(EMP);
  });

  it("GAP-PAYROLL-FNF-01/02: no Submit / Finance Approve / Mark Disbursed buttons (no such endpoints exist); the gap is stated honestly", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        { id: "s1", employeeId: EMP, separationType: "retirement", separationDate: "2026-07-01", netPayableMinor: "1", status: "draft" },
        { id: "s2", employeeId: EMP, separationType: "retirement", separationDate: "2026-07-02", netPayableMinor: "1", status: "manager_approved" },
        { id: "s3", employeeId: EMP, separationType: "retirement", separationDate: "2026-07-03", netPayableMinor: "1", status: "finance_approved" },
      ],
      source: "api",
    });
    await renderPage();
    expect(screen.queryByRole("button", { name: /submit for approval|finance approve|mark disbursed/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Approval and payment recording for F&F settlements are not available/)).toBeInTheDocument();
  });

  it("renders an empty state when there are no settlements", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    await renderPage();
    expect(screen.getByText("No F&F settlements yet")).toBeInTheDocument();
  });

  it("shows the error data-source badge on API failure", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    await renderPage();
    expect(screen.getByText("Couldn't load F&F settlements — showing nothing")).toBeInTheDocument();
  });

  it.each([["employee"], ["manager"], ["hr_officer"]])(
    "GAP-PAYROLL-FNF-02: role %s gets PermissionDenied and no settlements fetch (mirrors payroll-service FNF_ROLES)",
    async (role) => {
      getSessionRolesMock.mockReturnValue([role]);
      await renderPage();
      expect(fetchJsonMock).not.toHaveBeenCalled();
      expect(screen.queryByText("Compute F&F Settlement")).not.toBeInTheDocument();
    },
  );

  it.each([["finance_officer"], ["hr_admin"], ["super_admin"]])("GAP-PAYROLL-FNF-02: role %s can open the page", async (role) => {
    getSessionRolesMock.mockReturnValue([role]);
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    await renderPage();
    expect(screen.getByText("Compute F&F Settlement")).toBeInTheDocument();
  });
});
