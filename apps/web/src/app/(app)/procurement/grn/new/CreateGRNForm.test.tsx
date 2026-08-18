import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { CreateGRNForm } from "./CreateGRNForm";

describe("CreateGRNForm — required-field ARIA (Req 3.5)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // The component fetches vendors/POs on mount; return empty lists so the
    // form renders in its "loading…" placeholder state without erroring.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } }),
    );
  });

  it("marks the Purchase order and Vendor selects as aria-required", async () => {
    render(<CreateGRNForm inspectorId="user-1" />);
    const poSelect = await screen.findByLabelText("Purchase order *");
    const vendorSelect = await screen.findByLabelText("Vendor *");
    expect(poSelect).toHaveAttribute("aria-required", "true");
    expect(vendorSelect).toHaveAttribute("aria-required", "true");
  });

  it("points required fields at the error message via aria-describedby once a validation error is shown", async () => {
    render(<CreateGRNForm inspectorId="user-1" />);
    const poSelect = await screen.findByLabelText("Purchase order *");
    expect(poSelect).not.toHaveAttribute("aria-describedby");

    const submit = screen.getByRole("button", { name: "Record GRN" });
    fireEvent.click(submit);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/required/i);
    });
    const errorMessage = screen.getByRole("alert");
    expect(errorMessage).toHaveAttribute("id", "grn-form-message");
    expect(poSelect).toHaveAttribute("aria-describedby", "grn-form-message");
  });
});
