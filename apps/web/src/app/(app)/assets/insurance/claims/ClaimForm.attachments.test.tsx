import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
// The real uploader talks to the presign endpoint + storage; here it just reports an uploaded file.
let uploadCount = 0;
vi.mock("@/app/_components/ds/FileUpload", () => ({
  FileUpload: ({ onUploaded, label }: { onUploaded?: (key: string, meta: { fileName: string; size: number; mimeType: string }) => void; label?: string }) => (
    <button
      type="button"
      onClick={() => {
        uploadCount += 1;
        onUploaded?.(`uploads/t1/attachment/00000000-0000-4000-8000-00000000000${uploadCount}.pdf`, { fileName: `fir-${uploadCount}.pdf`, size: 2048, mimeType: "application/pdf" });
      }}
    >
      {label}
    </button>
  ),
}));

import { ClaimForm } from "./ClaimForm";
import type { PolicyOption } from "./page";

const policies: PolicyOption[] = [
  { id: "p1", policyNo: "POL-1", insurer: "NIC", assetId: "a1", coverageMinor: "1000000", startDate: "2026-04-01", endDate: "2099-03-31", status: "active" },
];

// GAP-ASSETS-INSURANCE-CLAIMS-06
describe("ClaimForm supporting documents", () => {
  beforeEach(() => { vi.restoreAllMocks(); uploadCount = 0; });

  it("lists uploaded documents, lets one be removed, and sends the references with the claim", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "c1" }), { status: 202 }));
    render(<ClaimForm policies={policies} preselectedPolicyId="p1" />);
    fireEvent.change(screen.getByLabelText(/^Claim Date/), { target: { value: "2026-06-15" } });
    fireEvent.change(screen.getByLabelText(/^Claim Amount/), { target: { value: "8000" } });
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Line one\nLine two" } });
    fireEvent.click(screen.getByRole("button", { name: /Supporting documents/ }));
    fireEvent.click(screen.getByRole("button", { name: /Supporting documents/ }));
    expect(screen.getByRole("list", { name: "Attached documents" })).toHaveTextContent("fir-1.pdf");
    expect(screen.getByText("fir-2.pdf")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove fir-1.pdf" }));
    expect(screen.queryByText("fir-1.pdf")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "File insurance claim" }));
    await waitFor(() => expect(screen.getByText("File this claim?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("File claim"));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.attachments).toEqual([{ key: "uploads/t1/attachment/00000000-0000-4000-8000-000000000002.pdf", fileName: "fir-2.pdf", size: 2048, mimeType: "application/pdf" }]);
    expect(body.notes).toBe("Line one\nLine two");
  });

  it("stops offering the uploader at the 5-document cap", () => {
    render(<ClaimForm policies={policies} preselectedPolicyId="p1" />);
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole("button", { name: /Supporting documents/ }));
    expect(screen.queryByRole("button", { name: /Supporting documents/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Maximum of 5 documents attached/)).toBeInTheDocument();
  });
});
