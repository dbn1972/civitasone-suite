import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { CreateInstalmentPlanForm } from "./CreateInstalmentPlanForm";

function fillValidForm() {
  fireEvent.change(screen.getByLabelText(/^Number of Instalments/), { target: { value: "6" } });
  fireEvent.change(screen.getByLabelText(/^Start Date/), { target: { value: "2026-04-01" } });
}

describe("CreateInstalmentPlanForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires a valid instalment count before opening the confirm dialog", () => {
    render(<CreateInstalmentPlanForm assesseeId="a1" />);
    fireEvent.click(screen.getByText("Create Instalment Plan"));
    expect(screen.getByText("Please correct the highlighted fields.")).toBeInTheDocument();
  });

  it("creates a plan on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "plan-1", status: "accepted", correlationId: "c1" }), { status: 202 }),
    );

    render(<CreateInstalmentPlanForm assesseeId="a1" />);
    fillValidForm();
    fireEvent.click(screen.getByText("Create Instalment Plan"));

    await waitFor(() => expect(screen.getByText("Create this instalment plan?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create plan"));

    await waitFor(() => {
      expect(screen.getByText(/Instalment plan submitted/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<CreateInstalmentPlanForm assesseeId="a1" />);
    fillValidForm();
    fireEvent.click(screen.getByText("Create Instalment Plan"));

    await waitFor(() => expect(screen.getByText("Create this instalment plan?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create plan"));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 500/)).toBeInTheDocument();
    });
  });
});
