import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { ElectFlexBenefitForm } from "./ElectFlexBenefitForm";

describe("ElectFlexBenefitForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires a plan id before opening the confirm dialog", () => {
    render(<ElectFlexBenefitForm />);
    fireEvent.click(screen.getByRole("button", { name: "Submit Election" }));
    expect(screen.getByText("Plan ID is required.")).toBeInTheDocument();
  });

  it("submits an election on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ data: { id: "el1", planId: "pl1", fy: "2025-26", totalElectedMinor: 500000 } }),
        { status: 201 },
      ),
    );

    render(<ElectFlexBenefitForm />);
    fireEvent.change(screen.getByLabelText(/^Plan ID/), { target: { value: "pl1" } });
    fireEvent.change(screen.getByLabelText(/^Financial Year/), { target: { value: "2025-26" } });
    fireEvent.change(screen.getByLabelText("Component"), { target: { value: "LTA" } });
    fireEvent.change(screen.getByLabelText("Elected Amount (₹)"), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Election" }));

    await waitFor(() => expect(screen.getByText("Submit this flex benefit election?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Submit election"));

    await waitFor(() => {
      expect(screen.getByText(/Election submitted:/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 400 }));

    render(<ElectFlexBenefitForm />);
    fireEvent.change(screen.getByLabelText(/^Plan ID/), { target: { value: "pl1" } });
    fireEvent.change(screen.getByLabelText(/^Financial Year/), { target: { value: "2025-26" } });
    fireEvent.change(screen.getByLabelText("Component"), { target: { value: "LTA" } });
    fireEvent.change(screen.getByLabelText("Elected Amount (₹)"), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Election" }));

    await waitFor(() => expect(screen.getByText("Submit this flex benefit election?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Submit election"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR/)).not.toBeInTheDocument();
  });

  // Row identity: election lines were keyed by array position, so removing
  // an earlier line shifted later ones up into a different key -- React
  // patched the focused line's DOM node in place with a different line's
  // data instead of removing the right node and leaving the rest (and
  // focus) alone.
  it("keeps a line's own value and focus attached to it after an earlier line is removed", () => {
    render(<ElectFlexBenefitForm />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add line" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Add line" }));
    // Three lines now. Fill and focus the third one's Component field.
    const thirdComponent = screen.getAllByLabelText("Component")[2];
    fireEvent.change(thirdComponent, { target: { value: "Meal Vouchers" } });
    thirdComponent.focus();
    expect(document.activeElement).toBe(thirdComponent);

    // Remove the first line -- lines 2-3 shift up to become lines 1-2.
    fireEvent.click(screen.getByRole("button", { name: "Remove election line 1" }));

    const survivingThirdLine = screen.getAllByLabelText("Component")[1];
    expect(survivingThirdLine).toHaveValue("Meal Vouchers");
    expect(document.activeElement).toBe(survivingThirdLine);
  });
});
