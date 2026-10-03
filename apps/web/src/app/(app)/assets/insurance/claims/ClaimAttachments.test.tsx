import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ClaimAttachments } from "./ClaimAttachments";
import { mapClaimDetail } from "./[id]/claimDetail";

const A = { key: "uploads/t1/attachment/00000000-0000-4000-8000-000000000001.pdf", fileName: "fir.pdf", size: 2048, mimeType: "application/pdf" };

describe("ClaimAttachments (GAP-ASSETS-INSURANCE-CLAIMS-06)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows a dash when there are no documents", () => {
    render(<ClaimAttachments attachments={[]} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("opens a short-lived signed download link on demand, in a new tab without an opener", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ downloadUrl: "https://files.example/signed", key: A.key }), { status: 200 }));
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<ClaimAttachments attachments={[A]} />);
    expect(screen.getByText("fir.pdf")).toBeInTheDocument();
    expect(screen.getByText(/2\.0 KB/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open fir.pdf" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://files.example/signed", "_blank", "noopener,noreferrer"));
    expect(String(fetchSpy.mock.calls[0]![0])).toBe(`/api/proxy/v1/admin/uploads/${encodeURIComponent(A.key)}`);
  });

  it("shows plain copy when the link cannot be minted", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 403 }));
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<ClaimAttachments attachments={[A]} />);
    fireEvent.click(screen.getByRole("button", { name: "Open fir.pdf" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't open fir.pdf");
    expect(open).not.toHaveBeenCalled();
  });

  it("the claim detail mapper carries attachments (empty when absent)", () => {
    expect(mapClaimDetail({ id: "c1", policyId: "p1", attachments: [A] })!.attachments).toEqual([A]);
    expect(mapClaimDetail({ id: "c1", policyId: "p1" })!.attachments).toEqual([]);
  });
});
