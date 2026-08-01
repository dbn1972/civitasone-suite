import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { WriteOffCreateForm } from "./WriteOffCreateForm";

function fillValidForm() {
  fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "1200.00" } });
  fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: "Deceased assessee, no legal heir traced" } });
}

describe("WriteOffCreateForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires amount and reason before opening the confirm dialog", () => {
    render(<WriteOffCreateForm assesseeId="a1" />);
    fireEvent.click(screen.getByRole("button", { name: "Raise Write-off" }));
    expect(screen.getByText("Please correct the highlighted fields.")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid amount greater than zero.")).toBeInTheDocument();
    expect(screen.getByText("Reason is required.")).toBeInTheDocument();
  });

  it("raises a write-off on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "wo-1", status: "accepted" }), { status: 202 }),
    );

    render(<WriteOffCreateForm assesseeId="a1" />);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Raise Write-off" }));

    await waitFor(() => expect(screen.getByText("Raise this write-off?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Raise write-off"));

    await waitFor(() => {
      expect(screen.getByText(/Write-off raised/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<WriteOffCreateForm assesseeId="a1" />);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Raise Write-off" }));

    await waitFor(() => expect(screen.getByText("Raise this write-off?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Raise write-off"));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 500/)).toBeInTheDocument();
    });
  });
});
