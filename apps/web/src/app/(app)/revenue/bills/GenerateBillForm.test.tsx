import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { GenerateBillForm } from "./GenerateBillForm";
import type { DemandRow } from "./page";

const demands: DemandRow[] = [
  {
    id: "d1",
    assessmentId: "asmt-1",
    financialYear: "2025-2026",
    dueDate: "2026-03-31",
    principalMinor: "500000",
    rebateMinor: "0",
    penaltyMinor: "0",
    interestMinor: "0",
    netMinor: "500000",
    status: "raised",
  },
];

describe("GenerateBillForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires a demand selection before opening the confirm dialog", () => {
    render(<GenerateBillForm assesseeId="a1" demands={demands} />);
    fireEvent.click(screen.getByText("Generate Bill"));
    expect(screen.getByText("Select a demand to generate a bill for.")).toBeInTheDocument();
  });

  it("generates a bill on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "bill-1", status: "accepted", correlationId: "c1" }), { status: 202 }),
    );

    render(<GenerateBillForm assesseeId="a1" demands={demands} />);
    fireEvent.change(screen.getByLabelText(/^Demand/), { target: { value: "d1" } });
    fireEvent.click(screen.getByText("Generate Bill"));

    await waitFor(() => expect(screen.getByText("Generate this bill?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Generate bill"));

    await waitFor(() => {
      expect(screen.getByText(/Bill generation submitted/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<GenerateBillForm assesseeId="a1" demands={demands} />);
    fireEvent.change(screen.getByLabelText(/^Demand/), { target: { value: "d1" } });
    fireEvent.click(screen.getByText("Generate Bill"));

    await waitFor(() => expect(screen.getByText("Generate this bill?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Generate bill"));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 500/)).toBeInTheDocument();
    });
  });
});
