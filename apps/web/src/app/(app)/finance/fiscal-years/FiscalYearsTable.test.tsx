import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { FiscalYearsTable } from "./FiscalYearsTable";

const rows = [
  { code: "2025-26", label: "FY 2025-26", startDate: "2025-04-01", endDate: "2026-03-31", status: "closed" },
  { code: "2026-27", label: "FY 2026-27", startDate: "2026-04-01", endDate: "2027-03-31", status: "closed" },
];

describe("FiscalYearsTable", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("gives each row's Activate button a unique accessible name", () => {
    render(<FiscalYearsTable rows={rows} />);
    expect(screen.getByRole("button", { name: "Activate fiscal year 2025-26" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activate fiscal year 2026-27" })).toBeInTheDocument();
  });

  it("does not show an Activate button for the already-active year", () => {
    render(
      <FiscalYearsTable
        rows={[{ code: "2026-27", label: "FY 2026-27", startDate: "2026-04-01", endDate: "2027-03-31", status: "active" }]}
      />,
    );
    expect(screen.queryByRole("button", { name: /Activate fiscal year 2026-27/ })).not.toBeInTheDocument();
    expect(screen.getByText("Currently active")).toBeInTheDocument();
  });

  it("activates a fiscal year on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "activated", code: "2025-26" }), { status: 200 }),
    );

    render(<FiscalYearsTable rows={rows} />);
    fireEvent.click(screen.getByRole("button", { name: "Activate fiscal year 2025-26" }));

    await waitFor(() => expect(screen.getByText("Activate this fiscal year?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Activate fiscal year"));

    await waitFor(() => {
      expect(screen.getByText("Fiscal year 2025-26 is now active.")).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<FiscalYearsTable rows={rows} />);
    fireEvent.click(screen.getByRole("button", { name: "Activate fiscal year 2025-26" }));

    await waitFor(() => expect(screen.getByText("Activate this fiscal year?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Activate fiscal year"));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 500/)).toBeInTheDocument();
    });
  });
});
