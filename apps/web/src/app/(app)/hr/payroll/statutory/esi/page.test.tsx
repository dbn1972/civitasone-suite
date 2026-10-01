import { describe, it, expect, vi, beforeEach } from "vitest";

// Role gate (see the page's own GAP comment): default every test to an
// authorized payroll role; the gate tests below override per call.
const { getSessionRolesMock } = vi.hoisted(() => ({ getSessionRolesMock: vi.fn((): string[] => ["payroll_admin"]) }));
vi.mock("@/lib/auth/roleGuard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/roleGuard")>()),
  getSessionRoles: getSessionRolesMock,
}));
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import EsiStatutoryPage from "./page";

describe("EsiStatutoryPage", () => {
  beforeEach(() => {
    getSessionRolesMock.mockReturnValue(["payroll_admin"]);
    fetchJsonMock.mockReset();
  });

  it("renders the ESI ledger", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [{ id: "1", employeeId: "e1", period: "2026-06", grossMinor: 3000000, empContribMinor: 22500, erContribMinor: 97500 }],
      source: "api",
    });
    const ui = await EsiStatutoryPage();
    render(ui);
    expect(screen.getByText("e1")).toBeInTheDocument();
  });

  it("renders an empty state when there are no ESI records", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    const ui = await EsiStatutoryPage();
    render(ui);
    expect(screen.getByText("No ESI records")).toBeInTheDocument();
  });

  it("shows the saved-information badge when the loader errors", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    const ui = await EsiStatutoryPage();
    render(ui);
    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });

  it("GAP-PAYROLL-STATUTORY-ESI-01: shows Access restricted to employee/manager without calling the API", async () => {
    getSessionRolesMock.mockReturnValue(["employee", "manager"]);
    const ui = await EsiStatutoryPage();
    render(ui);
    expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });
});
