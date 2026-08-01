import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { CreateRateHeadForm } from "./CreateRateHeadForm";

describe("CreateRateHeadForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires code, name, and category before opening the confirm dialog", () => {
    render(<CreateRateHeadForm />);
    fireEvent.click(screen.getByRole("button", { name: "Create Rate Head" }));
    expect(screen.getByText("Rate head code is required.")).toBeInTheDocument();
  });

  it("creates a rate head on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "rh-1", status: "accepted", correlationId: "c1" }), { status: 202 }),
    );

    render(<CreateRateHeadForm />);
    fireEvent.change(screen.getByLabelText(/^Code/), { target: { value: "PT" } });
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Property Tax" } });
    fireEvent.change(screen.getByLabelText(/^Category/), { target: { value: "property_tax" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Rate Head" }));

    await waitFor(() => expect(screen.getByText("Create this rate head?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create rate head"));

    await waitFor(() => {
      expect(screen.getByText(/Rate head submitted/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<CreateRateHeadForm />);
    fireEvent.change(screen.getByLabelText(/^Code/), { target: { value: "PT" } });
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Property Tax" } });
    fireEvent.change(screen.getByLabelText(/^Category/), { target: { value: "property_tax" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Rate Head" }));

    await waitFor(() => expect(screen.getByText("Create this rate head?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create rate head"));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 500/)).toBeInTheDocument();
    });
  });
});
