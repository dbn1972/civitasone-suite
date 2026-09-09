import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import EmployeeTypesPage from "./page";

const MOCK_TYPES = [
  {
    id: "t1", code: "PERM", name: "Permanent", description: null,
    eligibleForLeave: true, eligibleForPayroll: true, eligibleForAppraisal: true,
    defaultProbationMonths: 6, maxContractMonths: null,
    payMode: "monthly", isActive: true, sortOrder: 1,
  },
];

describe("EmployeeTypesPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders employee types and real stat counts on success", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_TYPES, source: "api" });
    render(await EmployeeTypesPage());
    expect(screen.getAllByText("Total Types").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
  });

  it("shows the honest empty state when there genuinely are no employee types", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await EmployeeTypesPage());
    expect(screen.getByText("No employee types defined")).toBeInTheDocument();
  });

  it("shows the error state — not zero stat cards or the empty-state prompt — on a real fetch failure", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    render(await EmployeeTypesPage());
    expect(screen.getByText("We couldn't load this employee types.")).toBeInTheDocument();
    expect(screen.queryByText("No employee types defined")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
