import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import QuarterAllotmentsPage from "./page";

const ALLOTMENT = {
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  quarterId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  employeeRef: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  employeeName: null,
  quarterNo: "B-14",
  designation: "Section Officer",
  payLevel: "7",
  eligibilityScore: 71,
  appliedAt: "2026-07-01T00:00:00.000Z",
  status: "applied",
  version: 1,
};

describe("QuarterAllotmentsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the allotments list with quarter number", async () => {
    fetchJsonMock.mockResolvedValue({ data: { rows: [ALLOTMENT], total: 1 }, source: "api" });
    const ui = await QuarterAllotmentsPage();
    render(ui);

    // GAP-ESTAB-QUARTERS-ALLOTMENTS-01: quarter number shown, not UUID prefix
    expect(screen.getByText("B-14")).toBeInTheDocument();
    expect(screen.getByText("Section Officer")).toBeInTheDocument();
    // GAP-ESTAB-QUARTERS-ALLOTMENTS-05: eligibility score column
    expect(screen.getByText("71")).toBeInTheDocument();
  });

  // UX-021: employee real name
  it("shows the employee real name when resolved", async () => {
    fetchJsonMock.mockResolvedValue({ data: { rows: [{ ...ALLOTMENT, employeeName: "Meera Iyer" }], total: 1 }, source: "api" });
    const ui = await QuarterAllotmentsPage();
    render(ui);

    expect(screen.getByText("Meera Iyer")).toBeInTheDocument();
  });

  // GAP-ESTAB-QUARTERS-ALLOTMENTS-03: no duplicate employee ref column
  it("does not render a duplicate Employee ref column", async () => {
    fetchJsonMock.mockResolvedValue({ data: { rows: [ALLOTMENT], total: 1 }, source: "api" });
    const ui = await QuarterAllotmentsPage();
    render(ui);

    // Should not have a column header "Employee ref"
    expect(screen.queryByText("Employee ref")).not.toBeInTheDocument();
  });

  it("renders an empty state when there are no allotments", async () => {
    fetchJsonMock.mockResolvedValue({ data: { rows: [], total: 0 }, source: "api" });
    const ui = await QuarterAllotmentsPage();
    render(ui);

    expect(screen.getByText("No allotment applications yet")).toBeInTheDocument();
  });

  // GAP-ESTAB-QUARTERS-ALLOTMENTS-04: single error block with Retry
  it("shows RefreshErrorState on error, not multiple badges", async () => {
    fetchJsonMock.mockResolvedValue({ data: { rows: [], total: 0 }, source: "error" });
    const ui = await QuarterAllotmentsPage();
    render(ui);

    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText("No allotment applications yet")).not.toBeInTheDocument();
  });

  // GAP-ESTAB-QUARTERS-ALLOTMENTS-02: caption does not falsely claim "current financial year"
  it("caption does not claim current financial year", async () => {
    fetchJsonMock.mockResolvedValue({ data: { rows: [ALLOTMENT], total: 1 }, source: "api" });
    const ui = await QuarterAllotmentsPage();
    render(ui);

    expect(screen.queryByText(/current financial year/)).not.toBeInTheDocument();
    expect(screen.getByText("Quarter allotments")).toBeInTheDocument();
  });
});
