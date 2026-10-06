import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { InspectGrnForm } from "./InspectGrnForm";

describe("InspectGrnForm (GAP-PROCUREMENT-GRN-DETAIL-01 / 03)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("does not fire a fetch until the Accept confirm dialog is confirmed", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 202 }),
    );
    render(<InspectGrnForm grnId="g1" grnNo="GRN/2026/0001" />);

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    // Dialog opened, but no network call yet.
    await screen.findByText(/Accept this GRN\?/i);
    expect(fetchSpy).not.toHaveBeenCalled();

    const confirm = screen.getByRole("button", { name: "Accept GRN" });
    fireEvent.click(confirm);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(fetchSpy.mock.calls[0]![0]).toContain("/grns/g1/accept");
  });

  it("blocks Reject confirm until a reason is entered", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    render(<InspectGrnForm grnId="g1" grnNo="GRN/2026/0001" />);

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    await screen.findByText(/Reject this GRN\?/i);
    const confirm = screen.getByRole("button", { name: "Reject GRN" });
    expect(confirm).toBeDisabled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("surfaces the catalogued SoD message when the server returns SOD_VIOLATION", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "SOD_VIOLATION" }), { status: 403 }),
    );
    render(<InspectGrnForm grnId="g1" grnNo="GRN/2026/0001" />);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await screen.findByText(/Accept this GRN\?/i);
    fireEvent.click(screen.getByRole("button", { name: "Accept GRN" }));
    await waitFor(() =>
      expect(screen.getByText(/you cannot also inspect it/i)).toBeInTheDocument(),
    );
  });

  it("disables Accept/Reject up front when the viewer created the GRN (SoD pre-emption)", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<InspectGrnForm grnId="g1" grnNo="GRN/2026/0001" isCreator />);
    expect(screen.getByRole("button", { name: "Accept" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
    expect(screen.getByText(/a different\s+officer must accept or reject it/i)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
