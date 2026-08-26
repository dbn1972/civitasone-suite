import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Stub the real (presigned-S3) FileUpload so this test exercises only
// TenderDocumentsPage's own wiring, not FileUpload's internals (covered by
// its own FileUpload.test.tsx). Clicking the stub simulates a completed
// upload by calling onUploaded with a realistic S3 key.
const FAKE_KEY = "uploads/tenant-1/document/9f1c2e-brochure.pdf";
vi.mock("../../../../../_components/ds", () => ({
  FileUpload: ({ onUploaded }: { onUploaded: (key: string) => void }) => (
    <button type="button" onClick={() => onUploaded(FAKE_KEY)}>Simulate completed upload</button>
  ),
}));

import TenderDocumentsPage from "./page";

const TENDER_ID = "33333333-3333-3333-3333-333333333333";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("TenderDocumentsPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps Save disabled until a file has actually finished uploading", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [] }));
    render(<TenderDocumentsPage params={{ id: TENDER_ID }} />);
    await waitFor(() => expect(screen.getByText("No documents uploaded yet.")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Title *"), { target: { value: "NIT Document" } });
    expect(screen.getByRole("button", { name: "Save document" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Simulate completed upload" }));
    expect(screen.getByRole("button", { name: "Save document" })).toBeEnabled();
  });

  // Regression test for the core bug: the old handler base64-encoded the
  // whole file and then sliced the result to 200 characters before sending
  // it as storageRef ("base64:" + file.name + ":" + base64.slice(0, 200)),
  // silently truncating/corrupting every real upload while still reporting
  // "Document uploaded successfully." The fix persists the real S3 key that
  // FileUpload's presigned upload produced, unmodified.
  it("saves the document with the real upload key as storageRef, not a re-encoded/truncated value", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: [] })) // initial load()
      .mockResolvedValueOnce(new Response("", { status: 200 })) // POST save
      .mockResolvedValueOnce(jsonResponse({ data: [] })); // reload after save

    render(<TenderDocumentsPage params={{ id: TENDER_ID }} />);
    await waitFor(() => expect(screen.getByText("No documents uploaded yet.")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Title *"), { target: { value: "NIT Document" } });
    fireEvent.click(screen.getByRole("button", { name: "Simulate completed upload" }));
    fireEvent.click(screen.getByRole("button", { name: "Save document" }));

    await waitFor(() => {
      expect(screen.getByText("Document uploaded.")).toBeInTheDocument();
    });

    const saveCall = fetchSpy.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "POST",
    );
    expect(saveCall).toBeDefined();
    const body = JSON.parse((saveCall![1] as RequestInit).body as string);
    expect(body.storageRef).toBe(FAKE_KEY);
    expect(body.storageRef.startsWith("base64:")).toBe(false);
    expect(body.storageRef.length).not.toBe(200);
  });

  it("resolves a presigned download URL instead of linking directly to the raw storage key", async () => {
    const doc = { id: "doc-1", docType: "nit", title: "NIT", storageRef: FAKE_KEY, createdAt: "2026-01-01" };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: [doc] })) // initial load()
      .mockResolvedValueOnce(jsonResponse({ downloadUrl: "https://s3.example/signed?x=1", key: FAKE_KEY }));
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    render(<TenderDocumentsPage params={{ id: TENDER_ID }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Download" }));

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith("https://s3.example/signed?x=1", "_blank", "noopener,noreferrer");
    });
  });
});
