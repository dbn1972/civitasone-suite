import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { LwfConfigForm } from "./LwfConfigForm";

describe("LwfConfigForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires a state code before opening the confirm dialog", () => {
    render(<LwfConfigForm />);
    fireEvent.click(screen.getByRole("button", { name: "Save LWF Configuration" }));
    expect(screen.getByText("State code is required.")).toBeInTheDocument();
  });

  it("saves an LWF configuration on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { stateCode: "KA", saved: true } }), { status: 201 }),
    );

    render(<LwfConfigForm />);
    fireEvent.change(screen.getByLabelText(/State Code/), { target: { value: "KA" } });
    fireEvent.click(screen.getByRole("button", { name: "Save LWF Configuration" }));

    await waitFor(() => expect(screen.getByText("Save this LWF configuration?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Confirm & Save"));

    await waitFor(() => {
      expect(screen.getByText(/LWF configuration saved for KA\./)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<LwfConfigForm />);
    fireEvent.change(screen.getByLabelText(/State Code/), { target: { value: "KA" } });
    fireEvent.click(screen.getByRole("button", { name: "Save LWF Configuration" }));

    await waitFor(() => expect(screen.getByText("Save this LWF configuration?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Confirm & Save"));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 500/)).toBeInTheDocument();
    });
  });
});
