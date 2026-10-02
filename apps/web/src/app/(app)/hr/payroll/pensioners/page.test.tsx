import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
const getSessionRolesMock = vi.fn(() => ["payroll_officer"]);
vi.mock("@/lib/auth/roleGuard", async (io) => ({
  ...(await io<typeof import("@/lib/auth/roleGuard")>()),
  getSessionRoles: () => getSessionRolesMock(),
}));

import PensionersPage from "./page";

const ACTIVE = { id: "p1", ppoNo: "PPO/1", fullName: "Ramesh Sharma", dateOfBirth: "1958-01-01", basicPensionMinor: 2500050, commutedPensionMinor: 0, commutationDate: null, medicalAllowanceMinor: 0, ddoCode: "DDO-1", taxRegime: "new", status: "active" };
const STOPPED = { ...ACTIVE, id: "p2", ppoNo: "PPO/2", fullName: "Sita Devi", basicPensionMinor: 1000000, status: "stopped" };

describe("PensionersPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    getSessionRolesMock.mockReturnValue(["payroll_officer"]);
  });

  it("GAP-PAYROLL-PENSIONERS-01: a failed load shows em dashes + the error state, never ₹0.00 or the empty-filter copy", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    render(await PensionersPage());
    expect(screen.queryByText("₹0.00")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText(/couldn't load pensioners/i)).toBeInTheDocument();
    expect(screen.queryByText(/match your filter/i)).not.toBeInTheDocument();
    expect(screen.queryByText("No pensioners registered yet")).not.toBeInTheDocument();
  });

  it("GAP-PAYROLL-PENSIONERS-01/03: a truly empty register shows real zeros and the register-empty copy", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await PensionersPage());
    expect(screen.getByText("₹0.00")).toBeInTheDocument();
    expect(screen.getByText("No pensioners registered yet")).toBeInTheDocument();
    expect(screen.queryByText(/match your filter/i)).not.toBeInTheDocument();
  });

  it("GAP-PAYROLL-PENSIONERS-02: the money stat is labelled as active BASIC pension and sums only active rows", async () => {
    fetchJsonMock.mockResolvedValue({ data: [ACTIVE, STOPPED], source: "api" });
    render(await PensionersPage());
    expect(screen.getByText("Basic Pension (Active)")).toBeInTheDocument();
    expect(screen.queryByText(/Payable This Month/)).not.toBeInTheDocument();
    expect(screen.getByText(/Excludes DA\/dearness relief/)).toBeInTheDocument();
    expect(screen.getByText("Basic Pension (Active)").parentElement).toHaveTextContent("₹25,000.50");
  });

  it("gates the page: an employee sees PermissionDenied and no pensioner fetch is made", async () => {
    getSessionRolesMock.mockReturnValue(["employee"]);
    render(await PensionersPage());
    expect(fetchJsonMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Ramesh Sharma")).not.toBeInTheDocument();
  });

  it("GAP-PAYROLL-PENSIONERS-04: shows a DPDP data-use notice under the header", async () => {
    fetchJsonMock.mockResolvedValue({ data: [ACTIVE], source: "api" });
    render(await PensionersPage());
    expect(screen.getByRole("note")).toHaveTextContent(/DPDP Act, 2023/);
  });
});
