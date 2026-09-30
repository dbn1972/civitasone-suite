import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DocumentsPanel } from "./DocumentsPanel";
import type { OnboardingDocument } from "./DocumentUploadCard";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

const PENDING_DOC: OnboardingDocument = { id: "pan_card", name: "PAN Card", required: true, status: "pending" };
const UPLOADED_DOC: OnboardingDocument = { id: "pan_card", name: "PAN Card", required: true, status: "uploaded", uploadedFileName: "pan.pdf", storageKey: "uploads/t1/document/abc.pdf" };

describe("DocumentsPanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("GAP-HR-ONBOARDING-DETAIL-02: calls mark-received with the real storage key once a file uploads, previously never wired to anything", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ uploadUrl: "https://s3.example/put", key: "uploads/t1/document/abc.pdf", headers: {} }) } as Response)
      .mockResolvedValueOnce({ ok: true } as Response) // the S3 PUT
      .mockResolvedValueOnce({ ok: true } as Response); // mark-received PATCH

    render(<DocumentsPanel employeeId="emp-1" documents={[PENDING_DOC]} />);
    const input = screen.getByLabelText("Choose file for PAN Card (required)");
    fireEvent.change(input, { target: { files: [new File(["x"], "pan.pdf", { type: "application/pdf" })] } });

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3));
    expect(global.fetch).toHaveBeenNthCalledWith(
      3,
      "/api/proxy/v1/hrms/employees/emp-1/onboarding-documents/pan_card/mark-received",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ storageKey: "uploads/t1/document/abc.pdf", fileName: "pan.pdf" }),
      }),
    );
  });

  it("GAP-HR-ONBOARDING-DETAIL-02: Verify calls the real verify endpoint with status 'verified'", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: true } as Response);
    render(<DocumentsPanel employeeId="emp-1" documents={[UPLOADED_DOC]} />);

    fireEvent.click(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/proxy/v1/hrms/employees/emp-1/onboarding-documents/pan_card/verify",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "verified" }) }),
      ),
    );
  });

  it("GAP-HR-ONBOARDING-DETAIL-02: Reject calls the real verify endpoint with status 'rejected'", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: true } as Response);
    render(<DocumentsPanel employeeId="emp-1" documents={[UPLOADED_DOC]} />);

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/proxy/v1/hrms/employees/emp-1/onboarding-documents/pan_card/verify",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "rejected" }) }),
      ),
    );
  });

  it("shows a clerk-safe inline error, and does not throw, when verify fails", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 500, clone: () => ({ json: async () => ({}) }) } as unknown as Response);
    render(<DocumentsPanel employeeId="emp-1" documents={[UPLOADED_DOC]} />);

    fireEvent.click(screen.getByRole("button", { name: "Verify" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/couldn't save/i);
  });
});
