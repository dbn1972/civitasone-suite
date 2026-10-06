import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

import { CreateSrnForm } from "./CreateSrnForm";

describe("CreateSrnForm (GAP-PROCUREMENT-GRN-DETAIL-SRN-NEW-01/02/03/05)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    push.mockClear();
    refresh.mockClear();
  });

  it("defaults to Draft (sign not pre-armed) and hides the received date until signing (NEW-02/03)", () => {
    render(<CreateSrnForm grnId="g1" storeOfficerLabel="A. Officer" />);
    const signNow = screen.getByLabelText(/Sign now/i) as HTMLInputElement;
    expect(signNow.checked).toBe(false);
    // Date field is not an editable control while not signing.
    expect(screen.queryByLabelText("Received date")).toBeNull();
    expect(screen.getByText(/Recorded when the SRN is signed/i)).toBeInTheDocument();
    // Submit button reads "Create draft SRN".
    expect(screen.getByRole("button", { name: "Create draft SRN" })).toBeInTheDocument();
  });

  it("shows the officer's display name, never a raw UUID (NEW-04)", () => {
    render(<CreateSrnForm grnId="g1" storeOfficerLabel="A. Officer" />);
    expect(screen.getByText("A. Officer")).toBeInTheDocument();
  });

  it("gates sign behind a confirm dialog — no fetch until confirmed (NEW-02)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    render(<CreateSrnForm grnId="g1" storeOfficerLabel="A. Officer" grnNo="GRN/2026/1" />);
    fireEvent.click(screen.getByLabelText(/Sign now/i));
    fireEvent.click(screen.getByRole("button", { name: "Sign & Submit" }));
    await screen.findByText(/Create and sign this SRN\?/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows an 'already exists' message on a 409 create (NEW-05)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 409 }));
    render(<CreateSrnForm grnId="g1" storeOfficerLabel="A. Officer" />);
    fireEvent.click(screen.getByRole("button", { name: "Create draft SRN" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/already exists/i));
  });

  it("routes to the SRN page with signFailed=1 when create succeeds but sign fails (NEW-01)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ id: "s1" }), { status: 201 }));
    fetchSpy.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    render(<CreateSrnForm grnId="g1" storeOfficerLabel="A. Officer" grnNo="GRN/2026/1" />);
    fireEvent.click(screen.getByLabelText(/Sign now/i));
    fireEvent.click(screen.getByRole("button", { name: "Sign & Submit" }));
    await screen.findByText(/Create and sign this SRN\?/i);
    fireEvent.click(screen.getByRole("button", { name: "Sign & create SRN" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/procurement/grn/g1/srn?signFailed=1"));
  });
});
