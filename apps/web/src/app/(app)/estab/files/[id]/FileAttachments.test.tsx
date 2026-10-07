import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { FileAttachments } from "./FileAttachments";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const urlOf = (args: unknown[]): string => (typeof args[0] === "string" ? args[0] : "");

function attachFile(input: HTMLInputElement) {
  const file = new File(["%PDF-1.4 fake pdf content"], "Annexure-I.pdf", { type: "application/pdf" });
  Object.defineProperty(file, "size", { value: 54321 });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
}

describe("FileAttachments — real presigned-URL upload, not a fake placeholder (F2 fix)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the FileUpload picker and disables 'Add attachment' until a real upload completes", () => {
    render(<FileAttachments fileId="file-1" attachments={[]} />);

    // The form uses the real DS FileUpload primitive (a file input), not a
    // typed-filename text box.
    expect(document.querySelector("input[type='file']")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add attachment" })).toBeDisabled();
  });

  it("uploads through the real presigned-URL flow and posts a real storageRef/size/mime — never the pending-upload: placeholder", async () => {
    const presignResponse = {
      uploadUrl: "https://s3.example.com/upload/estab-annexure",
      key: "attachment/estab/annexure-i-real-key.pdf",
      headers: { "content-type": "application/pdf" },
    };
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(presignResponse)) // 1. get presigned URL
      .mockResolvedValueOnce(new Response(null, { status: 200 })) // 2. PUT to S3
      .mockResolvedValueOnce(jsonResponse({})); // 3. real POST to the attachments endpoint

    render(<FileAttachments fileId="file-1" attachments={[]} />);

    const input = document.querySelector("input[type='file']") as HTMLInputElement;
    const file = new File(["%PDF-1.4 fake pdf content"], "Annexure-I.pdf", { type: "application/pdf" });
    Object.defineProperty(file, "size", { value: 54321 });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    fireEvent.change(input);

    // Upload completes (presign + S3 PUT) and the button unlocks.
    await waitFor(() => expect(screen.getByRole("button", { name: "Add attachment" })).not.toBeDisabled());
    expect(screen.getByText(/Ready to attach/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add attachment" }));

    await waitFor(() =>
      expect(fetchSpy.mock.calls.some((c) => urlOf(c).includes("/files/file-1/attachments"))).toBe(true),
    );

    const attachCall = fetchSpy.mock.calls.find((c) => urlOf(c).includes("/files/file-1/attachments"))!;
    const sentBody = JSON.parse((attachCall[1] as RequestInit).body as string) as Record<string, unknown>;

    // Real values from the actual uploaded file — not the old typed-name /
    // sizeBytes:0 / "pending-upload:<name>" placeholder.
    expect(sentBody.storageRef).toBe(presignResponse.key);
    expect(sentBody.fileName).toBe("Annexure-I.pdf");
    expect(sentBody.fileType).toBe("application/pdf");
    expect(sentBody.sizeBytes).toBe(54321);
    expect(String(sentBody.storageRef)).not.toMatch(/^pending-upload:/);
    expect(sentBody.sizeBytes).not.toBe(0);
  });

  it("shows a clerk-safe message, never the raw backend text, when the attach POST fails (UX-016)", async () => {
    const presignResponse = {
      uploadUrl: "https://s3.example.com/upload/estab-annexure",
      key: "attachment/estab/annexure-i-real-key.pdf",
      headers: { "content-type": "application/pdf" },
    };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(presignResponse)) // 1. presign
      .mockResolvedValueOnce(new Response(null, { status: 200 })) // 2. S3 PUT
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "attachment quota exceeded for this file" }), {
          status: 422,
          headers: { "content-type": "application/json" },
        }),
      ); // 3. attach POST fails

    render(<FileAttachments fileId="file-1" attachments={[]} />);
    const input = document.querySelector("input[type='file']") as HTMLInputElement;
    attachFile(input);

    await waitFor(() => expect(screen.getByRole("button", { name: "Add attachment" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Add attachment" }));

    await waitFor(() => expect(screen.getByText(/Some details weren't accepted\. Check what you entered and try again\./)).toBeInTheDocument());
    expect(document.body.textContent).not.toMatch(/attachment quota exceeded/i);
    expect(document.body.textContent).not.toMatch(/\b422\b/);
  });
});

describe("FileAttachments — download link (DETAIL-02)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders each attachment as a clickable download button, not plain text", () => {
    const atts = [
      { id: "a1", fileName: "Annexure-I.pdf", fileType: "application/pdf", size: 45000, uploadedAt: "2026-09-20T00:00:00Z" },
      { id: "a2", fileName: "Photo.jpg", fileType: "image/jpeg", size: 120000, uploadedAt: "2026-09-21T00:00:00Z" },
    ];
    render(<FileAttachments fileId="file-1" attachments={atts} />);

    // Each attachment is a button (interactive), not a span/text.
    const a1Btn = screen.getByRole("button", { name: "Annexure-I.pdf" });
    expect(a1Btn).toBeInTheDocument();
    const a2Btn = screen.getByRole("button", { name: "Photo.jpg" });
    expect(a2Btn).toBeInTheDocument();
    // Size info is rendered.
    expect(screen.getByText(/44 KB/)).toBeInTheDocument();
    expect(screen.getByText(/118 KB/)).toBeInTheDocument();
  });

  it("opens a presigned URL in a new tab on click, never exposes a dead text link", async () => {
    const windowOpenSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/download")) {
        return Promise.resolve(jsonResponse({ key: "uploads/t1/attachment/abc.pdf", fileName: "Annexure-I.pdf" }));
      }
      if (url.includes("/admin/uploads/")) {
        return Promise.resolve(jsonResponse({ downloadUrl: "https://s3.example.com/presigned-get" }));
      }
      return Promise.resolve(jsonResponse({}));
    });

    const atts = [{ id: "a1", fileName: "Annexure-I.pdf", fileType: "application/pdf", size: 45000, uploadedAt: "2026-09-20T00:00:00Z" }];
    render(<FileAttachments fileId="file-1" attachments={atts} />);

    fireEvent.click(screen.getByRole("button", { name: "Annexure-I.pdf" }));
    await waitFor(() =>
      expect(windowOpenSpy).toHaveBeenCalledWith("https://s3.example.com/presigned-get", "_blank", "noopener,noreferrer"),
    );
  });

  it("shows 'Unavailable' on 404, never a dead link", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ message: "not found" }, 404));

    const atts = [{ id: "a1", fileName: "Old-file.pdf", fileType: "application/pdf", size: 1000, uploadedAt: "2025-01-01T00:00:00Z" }];
    render(<FileAttachments fileId="file-1" attachments={atts} />);

    fireEvent.click(screen.getByRole("button", { name: "Old-file.pdf" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("This attachment is unavailable."),
    );
  });
});
