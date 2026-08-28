import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import ShiftRequestsPage from "./page";

// Matches the real GET /v1/hrms/shift-requests shape (employeeName, no department).
const MOCK_REQUESTS = [
  { id: "r1", employeeId: "e1", employeeName: "Priya Nair", currentShift: "General Duty", requestedShift: "Morning Shift", effectiveDate: "2026-09-01", reason: "Family care", status: "pending" },
  { id: "r2", employeeId: "e2", employeeName: "Arvind Kumar", currentShift: "Morning Shift", requestedShift: "Evening Shift", effectiveDate: "2026-09-01", reason: "Health", status: "approved" },
];

describe("ShiftRequestsPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders shift change requests from API", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_REQUESTS, source: "api" });
    render(await ShiftRequestsPage());
    expect(screen.getByText("Priya Nair")).toBeInTheDocument();
    expect(screen.getByText("Arvind Kumar")).toBeInTheDocument();
  });

  // NOTE: a fallback-mapping test (employeeName missing -> falls back to
  // employeeId) was attempted here but dropped: fetchJson is mocked at the
  // module boundary in this test file, so getData()'s mapResponse callback
  // (where the fallback lives) never actually runs against mocked data --
  // the mock's raw payload is returned as-is. The fallback logic itself
  // (`employeeName ?? employeeId`) is simple enough to trust via code
  // review; it cannot be meaningfully unit-tested at this boundary without
  // restructuring how fetchJson is mocked across this codebase's page tests.

  it("shows stat cards for pending and approved counts", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_REQUESTS, source: "api" });
    render(await ShiftRequestsPage());
    expect(screen.getByText("Pending Approval")).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();
  });

  it("renders page title", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await ShiftRequestsPage());
    // level: 1 disambiguates the PageHeader's <h1> from the Card's <h3>
    // title, which is also literally "Shift Change Requests".
    expect(screen.getByRole("heading", { level: 1, name: /shift change requests/i })).toBeInTheDocument();
  });

  it("renders empty state when no requests", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await ShiftRequestsPage());
    expect(screen.getByText(/No shift change requests/i)).toBeInTheDocument();
  });
});
