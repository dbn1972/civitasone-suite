import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import ShiftRequestsPage from "./page";

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

  it("shows stat cards for pending and approved counts", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_REQUESTS, source: "api" });
    render(await ShiftRequestsPage());
    expect(screen.getByText("Pending Approval")).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();
  });

  it("renders page title", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await ShiftRequestsPage());
    expect(screen.getByRole("heading", { name: /shift change requests/i })).toBeInTheDocument();
  });

  it("renders empty state when no requests", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await ShiftRequestsPage());
    expect(screen.getByText(/No shift change requests/i)).toBeInTheDocument();
  });
});
