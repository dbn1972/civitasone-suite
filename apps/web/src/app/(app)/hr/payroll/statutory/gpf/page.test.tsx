import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { getSessionRolesMock } = vi.hoisted(() => ({ getSessionRolesMock: vi.fn((): string[] => ["payroll_admin"]) }));
vi.mock("@/lib/auth/roleGuard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/roleGuard")>()),
  getSessionRoles: getSessionRolesMock,
}));

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import GpfStatutoryPage from "./page";

describe("GpfStatutoryPage", () => {
  beforeEach(() => {
    getSessionRolesMock.mockReturnValue(["payroll_admin"]);
    fetchJsonMock.mockReset();
  });

  it("renders the GPF ledger for a payroll role", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [{ id: "1", employeeId: "e1", period: "2026-06", basicMinor: 5000000, contribPct: 6, empContribMinor: 300000 }],
      source: "api",
    });
    const ui = await GpfStatutoryPage();
    render(ui);
    expect(screen.getByText("E1")).toBeInTheDocument();
  });

  it("GAP-PAYROLL-STATUTORY-GPF-03: shows Access restricted to employee/manager without calling the API", async () => {
    getSessionRolesMock.mockReturnValue(["employee", "manager"]);
    const ui = await GpfStatutoryPage();
    render(ui);
    expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("GAP-PAYROLL-STATUTORY-GPF-04/05: shows the employee name and formats the rate as a percent", async () => {
    fetchJsonMock.mockResolvedValue({
      // contrib_pct is a Postgres numeric: it can arrive as a string.
      data: [{ id: "1", employeeId: "e1", employeeName: "Asha Rao", period: "2026-06", basicMinor: 5000000, contribPct: "10.00", empContribMinor: 300000 }],
      source: "api",
    });
    const ui = await GpfStatutoryPage();
    render(ui);
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
    expect(screen.queryByText("e1")).not.toBeInTheDocument();
    expect(screen.getByText("10.0%")).toBeInTheDocument();
    expect(screen.getByText("Unique Employees (to date)")).toBeInTheDocument();
  });

  it("GAP-PAYROLL-STATUTORY-GPF-05: falls back to the HR employee number, then a short code -- never the full UUID", async () => {
    const uuid = "3f2a9c1e-7b44-4d2a-9e1f-0a1b2c3d4e5f";
    fetchJsonMock.mockResolvedValue({
      data: [
        { id: "1", employeeId: uuid, employeeName: null, employeeCode: "EMP-0042", period: "2026-06", basicMinor: 1, contribPct: 6, empContribMinor: 1 },
        { id: "2", employeeId: "9c8b7a6d-0000-4000-8000-000000000001", employeeName: null, period: "2026-06", basicMinor: 1, contribPct: 6, empContribMinor: 1 },
      ],
      source: "api",
    });
    const ui = await GpfStatutoryPage();
    render(ui);
    expect(screen.getByText("EMP-0042")).toBeInTheDocument();
    expect(screen.getByText("9C8B7A6D")).toBeInTheDocument();
    expect(screen.queryByText(uuid)).not.toBeInTheDocument();
  });
});
