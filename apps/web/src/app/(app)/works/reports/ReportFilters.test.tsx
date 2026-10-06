import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

import { ReportFilters } from "./ReportFilters";

describe("ReportFilters — GAP-WORKS-REPORTS-04 (date validation + active-filter echo)", () => {
  beforeEach(() => pushMock.mockReset());

  it("blocks an inverted range (To before From) with an inline error and does not navigate", () => {
    render(<ReportFilters />);
    // Set To first (no min constraint yet), then From later than it.
    fireEvent.change(screen.getByLabelText("Filter to date"), { target: { value: "2026-04-01" } });
    fireEvent.change(screen.getByLabelText("Filter from date"), { target: { value: "2026-05-01" } });
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));

    expect(screen.getByRole("alert").textContent).toMatch(/on or after/i);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("navigates with a valid (From <= To) range", () => {
    render(<ReportFilters />);
    fireEvent.change(screen.getByLabelText("Filter from date"), { target: { value: "2026-04-01" } });
    fireEvent.change(screen.getByLabelText("Filter to date"), { target: { value: "2026-05-01" } });
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));

    expect(pushMock).toHaveBeenCalledWith("/works/reports?fromDate=2026-04-01&toDate=2026-05-01");
  });

  it("echoes applied filters as active-filter chips", () => {
    render(<ReportFilters fromDate="2026-04-01" toDate="2026-05-01" divisionId="abc-123" />);
    expect(screen.getByText("From 2026-04-01")).toBeInTheDocument();
    expect(screen.getByText("To 2026-05-01")).toBeInTheDocument();
    expect(screen.getByText("Division abc-123")).toBeInTheDocument();
  });

  it("marks the date inputs invalid when an inverted range is submitted", () => {
    render(<ReportFilters />);
    fireEvent.change(screen.getByLabelText("Filter to date"), { target: { value: "2026-04-01" } });
    fireEvent.change(screen.getByLabelText("Filter from date"), { target: { value: "2026-05-01" } });
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(screen.getByLabelText("Filter to date")).toHaveAttribute("aria-invalid", "true");
  });

  it("blocks a non-UUID division id and does not navigate (REPORTS-01)", () => {
    render(<ReportFilters />);
    fireEvent.change(screen.getByLabelText("Filter by division UUID"), { target: { value: "DIV-001" } });
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(screen.getByRole("alert").textContent).toMatch(/valid UUID/i);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("navigates with a valid division UUID (REPORTS-01)", () => {
    render(<ReportFilters />);
    const uuid = "11111111-1111-1111-1111-111111111111";
    fireEvent.change(screen.getByLabelText("Filter by division UUID"), { target: { value: uuid } });
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(pushMock).toHaveBeenCalledWith(`/works/reports?divisionId=${uuid}`);
  });
});
