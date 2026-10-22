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

  // GAP-HR-ONBOARDING-DETAIL-02: the verify/reject write is async (202 -> queue consumer), so the panel polls the
  // documents list until the committed status is visible, then refreshes the page so the card re-adopts it.
  it("after Verify, polls the documents list and refreshes the page once 'verified' is visible", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let polls = 0;
      global.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PATCH") return { ok: true } as Response;
        polls += 1;
        // First poll: consumer has not applied the write yet. Second: it has.
        const status = polls >= 2 ? "verified" : "uploaded";
        return { ok: true, json: async () => ({ data: [{ docType: "pan_card", status }] }) } as Response;
      }) as unknown as typeof fetch;

      render(<DocumentsPanel employeeId="emp-1" documents={[UPLOADED_DOC]} />);
      fireEvent.click(screen.getByRole("button", { name: "Verify" }));

      await vi.advanceTimersByTimeAsync(3000);

      expect(global.fetch).toHaveBeenCalledWith(
        "/api/proxy/v1/hrms/employees/emp-1/onboarding-documents",
        expect.objectContaining({ cache: "no-store" }),
      );
      expect(polls).toBe(2);
      expect(refreshMock).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not refresh while the polled status is still the old one, and says it is still being applied", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      global.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PATCH") return { ok: true } as Response;
        return { ok: true, json: async () => ({ data: [{ docType: "pan_card", status: "uploaded" }] }) } as Response;
      }) as unknown as typeof fetch;

      render(<DocumentsPanel employeeId="emp-1" documents={[UPLOADED_DOC]} />);
      fireEvent.click(screen.getByRole("button", { name: "Reject" }));

      await vi.advanceTimersByTimeAsync(20000);

      expect(refreshMock).not.toHaveBeenCalled();
      expect(screen.getByText(/still processing/i)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a clerk-safe inline error, and does not throw, when verify fails", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 500, clone: () => ({ json: async () => ({}) }) } as unknown as Response);
    render(<DocumentsPanel employeeId="emp-1" documents={[UPLOADED_DOC]} />);

    fireEvent.click(screen.getByRole("button", { name: "Verify" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/couldn't save/i);
  });
});
