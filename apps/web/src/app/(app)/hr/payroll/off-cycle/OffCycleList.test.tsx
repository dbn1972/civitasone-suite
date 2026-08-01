import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { OffCycleList, type OffCycleRow } from "./OffCycleList";

const row: OffCycleRow = {
  id: "o1",
  run_type: "bonus",
  period: "2025-06",
  description: "Diwali bonus",
  total_amount_minor: 500000,
  total_tax_minor: 0,
  total_net_minor: 0,
  status: "draft",
  created_at: "2025-06-01T00:00:00Z",
};

describe("OffCycleList", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("renders draft runs with a Process action", () => {
    render(<OffCycleList rows={[row]} />);
    expect(screen.getByText("Diwali bonus")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Process" })).toBeInTheDocument();
  });

  it("processes a run on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "o1", status: "processed", totalTaxMinor: 150000, totalNetMinor: 350000 } }), {
        status: 200,
      }),
    );

    render(<OffCycleList rows={[row]} />);
    fireEvent.click(screen.getByRole("button", { name: "Process" }));

    await waitFor(() => expect(screen.getByText("Process this off-cycle run?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Process run"));

    await waitFor(() => {
      expect(screen.getByText(/processed\. Net payable/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 409 }));

    render(<OffCycleList rows={[row]} />);
    fireEvent.click(screen.getByRole("button", { name: "Process" }));

    await waitFor(() => expect(screen.getByText("Process this off-cycle run?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Process run"));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 409/)).toBeInTheDocument();
    });
  });
});
