import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test-utils/intl-render";

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

  it("routes to the SRN page with signFailed=1 when sign was requested but create returned no id (NEW-01)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 201 }));
    render(<CreateSrnForm grnId="g1" storeOfficerLabel="A. Officer" grnNo="GRN/2026/1" />);
    fireEvent.click(screen.getByLabelText(/Sign now/i));
    fireEvent.click(screen.getByRole("button", { name: "Sign & Submit" }));
    await screen.findByText(/Create and sign this SRN\?/i);
    fireEvent.click(screen.getByRole("button", { name: "Sign & create SRN" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/procurement/grn/g1/srn?signFailed=1"));
  });

  it("shows a validation message on a 422 create and links it via aria-describedby (NEW-05)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 422 }));
    render(<CreateSrnForm grnId="g1" storeOfficerLabel="A. Officer" />);
    fireEvent.click(screen.getByRole("button", { name: "Create draft SRN" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/Check the details/i));
    expect(screen.getByLabelText("Remarks")).toHaveAttribute("aria-describedby", "srn-form-message");
  });

  it("shows network-specific copy, not a raw exception, when fetch rejects (NEW-05)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNRESET 10.0.0.4:5432"));
    render(<CreateSrnForm grnId="g1" storeOfficerLabel="A. Officer" />);
    fireEvent.click(screen.getByRole("button", { name: "Create draft SRN" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/reach the server/i));
    expect(screen.getByRole("alert")).not.toHaveTextContent(/ECONNRESET/);
  });

  it("sends receivedAt (from the date field) and remarks in the sign PATCH body only when signing (NEW-03)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ id: "s1" }), { status: 201 }));
    fetchSpy.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    render(<CreateSrnForm grnId="g1" storeOfficerLabel="A. Officer" grnNo="GRN/2026/1" />);
    fireEvent.click(screen.getByLabelText(/Sign now/i));
    fireEvent.change(screen.getByLabelText("Received date"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Remarks"), { target: { value: "boxes dented" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign & Submit" }));
    await screen.findByText(/Create and sign this SRN\?/i);
    fireEvent.click(screen.getByRole("button", { name: "Sign & create SRN" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/procurement/grn/g1/srn"));
    const signCall = fetchSpy.mock.calls[1]!;
    expect(String(signCall[0])).toContain("/inventory/srn/s1/sign");
    const body = JSON.parse(String((signCall[1] as RequestInit).body)) as { receivedAt: string; remarks: string };
    expect(body.receivedAt.startsWith("2026-10-01")).toBe(true);
    expect(body.remarks).toBe("boxes dented");
  });
});
