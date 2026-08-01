import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { PtSlabForm } from "./PtSlabForm";

describe("PtSlabForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires a state code before opening the confirm dialog", () => {
    render(<PtSlabForm />);
    fireEvent.click(screen.getByRole("button", { name: "Save PT Slab" }));
    expect(screen.getByText("State code is required.")).toBeInTheDocument();
  });

  it("saves a PT slab on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { stateCode: "KA", saved: true } }), { status: 201 }),
    );

    render(<PtSlabForm />);
    fireEvent.change(screen.getByLabelText(/State Code/), { target: { value: "KA" } });
    fireEvent.change(screen.getByLabelText(/PT Amount/), { target: { value: "200" } });
    fireEvent.click(screen.getByRole("button", { name: "Save PT Slab" }));

    await waitFor(() => expect(screen.getByText("Save this professional tax slab?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Confirm & Save"));

    await waitFor(() => {
      expect(screen.getByText(/Professional tax slab saved for KA\./)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<PtSlabForm />);
    fireEvent.change(screen.getByLabelText(/State Code/), { target: { value: "KA" } });
    fireEvent.change(screen.getByLabelText(/PT Amount/), { target: { value: "200" } });
    fireEvent.click(screen.getByRole("button", { name: "Save PT Slab" }));

    await waitFor(() => expect(screen.getByText("Save this professional tax slab?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Confirm & Save"));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 500/)).toBeInTheDocument();
    });
  });
});
