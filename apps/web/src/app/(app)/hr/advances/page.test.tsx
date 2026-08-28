import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import AdvancesPage from "./page";

describe("AdvancesPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  // fetchJson itself is mocked (as everywhere else in this suite), which
  // bypasses getData()'s own mapResponse/mapAdvances -- so these mocks
  // supply data already in mapAdvances' own output shape, exercising the
  // same real mapAdvances() function directly for precision.
  it("falls back to the employee id instead of a blank dash when the backend row has no nested employee name", async () => {
    // Regression test: services/hrms-service's hrms_salary_advances table
    // only ever has a flat employee_id column -- the backend response never
    // nests an "employee" object -- so `a.employee?.name` was always
    // undefined and every row showed "--" for Employee, always.
    const { mapAdvances } = await import("./mapAdvances");
    fetchJsonMock.mockResolvedValue({
      data: mapAdvances([
        { id: "adv-1", employeeId: "emp-77", amountMinor: 500000, purpose: "Medical", recoveryMonths: 6, requestDate: "2026-07-01", status: "pending" },
      ]),
      source: "api",
    });

    const ui = await AdvancesPage();
    render(ui);

    expect(screen.getByText("emp-77")).toBeInTheDocument();
  });

  it("still prefers a resolved employee name when one is present", async () => {
    const { mapAdvances } = await import("./mapAdvances");
    fetchJsonMock.mockResolvedValue({
      data: mapAdvances([
        { id: "adv-2", employeeId: "emp-88", employee: { name: "Sunita Devi", employeeNo: "E-88" }, amountMinor: 300000, purpose: "Festival", recoveryMonths: 3, requestDate: "2026-07-01", status: "pending" },
      ]),
      source: "api",
    });

    const ui = await AdvancesPage();
    render(ui);

    expect(screen.getByText("Sunita Devi (E-88)")).toBeInTheDocument();
  });
});
