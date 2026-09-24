import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getEmployeeByIdMock = vi.fn();
vi.mock("../../../../_data/loaders", () => ({
  getEmployeeById: (...args: unknown[]) => getEmployeeByIdMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import EmployeeDetailPage from "./page";

describe("EmployeeDetailPage", () => {
  beforeEach(() => {
    getEmployeeByIdMock.mockReset();
  });

  // The flagship case for this fix: GET /v1/hrms/employees/:id
  // (services/hrms-service/src/modules/employee/routes.ts) 403s a manager
  // who asks for an employee id that isn't one of their own direct
  // reports, with the specific reason "managers may only view their own
  // direct reports' records". This is a PER-RECORD ownership check, not a
  // static role gate -- the same manager IS allowed for other employee
  // ids -- so there is no fixed requiredRoles list this page could ever
  // hardcode; only the live response can say why. Before this fix, this
  // 403 rendered identically to a real outage, telling the manager to
  // retry a request that can never succeed.
  it("shows an honest 'Access restricted' message with the backend's own reason for a 403 (never the generic retry message)", async () => {
    getEmployeeByIdMock.mockResolvedValue({
      data: null,
      source: "error",
      status: 403,
      errorMessage: "managers may only view their own direct reports' records",
    });

    const ui = await EmployeeDetailPage({ params: { id: "emp-not-mine" } });
    render(ui);

    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(
      screen.getByText("Managers may only view their own direct reports' records."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("still shows the generic 'couldn't load, try again' message for a genuine transient failure (no status -- e.g. a network error)", async () => {
    getEmployeeByIdMock.mockResolvedValue({ data: null, source: "error" });

    const ui = await EmployeeDetailPage({ params: { id: "emp-1" } });
    render(ui);

    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Access restricted" })).not.toBeInTheDocument();
  });
});
