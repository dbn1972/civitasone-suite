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
});
