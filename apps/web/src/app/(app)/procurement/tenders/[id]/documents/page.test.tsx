import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";

const FAKE_KEY = "uploads/tenant-1/document/9f1c2e-brochure.pdf";
vi.mock("../../../../../_components/ds", () => ({
  FileUpload: ({ onUploaded }: { onUploaded: (key: string) => void }) => (
    <button type="button" onClick={() => onUploaded(FAKE_KEY)}>Simulate completed upload</button>
  ),
  PageHeader: ({ title, subtitle }: { title: string; subtitle?: string }) => (
    <div><h1>{title}</h1>{subtitle ? <p>{subtitle}</p> : null}</div>
  ),
  StatusPill: ({ status }: { status: string }) => <span className="pill">{status}</span>,
  DataSourceBadge: () => <span>data-source-error</span>,
  ErrorState: ({ error, onRetry }: { error: { what: string }; onRetry?: () => void }) => (
    <div><span>{error.what}</span>{onRetry ? <button onClick={onRetry}>Try again</button> : null}</div>
  ),
  Button: ({ children, ...rest }: ComponentProps<"button">) => <button {...rest}>{children}</button>,
}));

import { TenderDocumentsClient } from "./TenderDocumentsClient";

const TENDER_ID = "33333333-3333-3333-3333-333333333333";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function renderClient(overrides: Partial<ComponentProps<typeof TenderDocumentsClient>> = {}) {
  return render(
    <TenderDocumentsClient
      tenderId={TENDER_ID}
      tenderNo="T-2025/12"
      title="Supply of laptops"
      status="draft"
      canUpload
      {...overrides}
    />,
  );
}

describe("TenderDocumentsClient (GAP-PROCUREMENT-TENDERS-DETAIL-DOCUMENTS-01/02/03/04/05)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("DOCUMENTS-02: shows the tender number + title, not the raw UUID", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [] }));
    renderClient();
    await waitFor(() => expect(screen.getByText("No documents uploaded yet.")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "T-2025/12" })).toBeInTheDocument();
    expect(screen.getByText("Supply of laptops")).toBeInTheDocument();
    expect(screen.queryByText(TENDER_ID)).not.toBeInTheDocument();
  });

  it("DOCUMENTS-02: a draft tender does not show the bidder-visibility warning", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [] }));
    renderClient({ status: "draft" });
    await waitFor(() => expect(screen.getByText("No documents uploaded yet.")).toBeInTheDocument());
    expect(screen.queryByText(/Bidders can see/)).not.toBeInTheDocument();
  });

  it("DOCUMENTS-02: a published tender shows the bidder-visibility warning", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [] }));
    renderClient({ status: "published" });
    await waitFor(() => expect(screen.getByText("No documents uploaded yet.")).toBeInTheDocument());
    expect(screen.getByText(/Bidders can see/)).toBeInTheDocument();
  });

  it("DOCUMENTS-01: a user without upload permission sees no upload form", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [] }));
    renderClient({ canUpload: false });
    await waitFor(() => expect(screen.getByText("No documents uploaded yet.")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Save document" })).not.toBeInTheDocument();
    expect(screen.getByText(/do not have permission/)).toBeInTheDocument();
  });

  it("DOCUMENTS-04: a 500 response shows an error state, not 'No documents uploaded yet.'", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ error: "boom" }, 500));
    renderClient();
    await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
    expect(screen.queryByText("No documents uploaded yet.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("DOCUMENTS-05: the Type chip shows a label, and the date uses the shared IST formatter", async () => {
    const doc = { id: "d1", tenderId: TENDER_ID, docType: "technical_spec", title: "Specs", storageRef: FAKE_KEY, mimeType: null, sizeBytes: null, uploadedAt: "2026-01-15" };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [doc] }));
    renderClient();
    await waitFor(() => expect(screen.getByText("Specs")).toBeInTheDocument());
    expect(screen.getByText("Technical specification")).toBeInTheDocument();
    expect(screen.getByText("15 Jan 2026")).toBeInTheDocument();
    expect(screen.queryByText("technical_spec")).not.toBeInTheDocument();
  });

  it("DOCUMENTS-03: a doc with only createdAt (no uploadedAt) still renders a formatted date", async () => {
    const doc = { id: "d2", tenderId: TENDER_ID, docType: "nit", title: "NIT", storageRef: FAKE_KEY, createdAt: "2026-02-20" };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [doc] }));
    renderClient();
    await waitFor(() => expect(screen.getByText("NIT")).toBeInTheDocument());
    expect(screen.getByText("20 Feb 2026")).toBeInTheDocument();
  });

  it("DOCUMENTS-01: a corrigendum posts to the corrigenda endpoint with the revised closing date", async () => {
    const spy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: [] }))      // initial load
      .mockResolvedValueOnce(new Response("", { status: 202 })) // POST corrigenda
      .mockResolvedValueOnce(new Response("", { status: 202 })) // POST documents
      .mockResolvedValueOnce(jsonResponse({ data: [] }));      // reload
    renderClient({ status: "published" });
    await waitFor(() => expect(screen.getAllByText("No documents uploaded yet.")[0]).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Title *"), { target: { value: "Corrigendum 1" } });
    fireEvent.change(screen.getByLabelText("Document type"), { target: { value: "corrigendum" } });
    fireEvent.change(screen.getByLabelText("Revised bid closing date"), { target: { value: "2026-05-01" } });
    fireEvent.change(screen.getByLabelText("Reason for corrigendum *"), { target: { value: "Extended for more bidders" } });
    fireEvent.click(screen.getByRole("button", { name: "Simulate completed upload" }));
    fireEvent.click(screen.getByRole("button", { name: "Save document" }));

    await waitFor(() => {
      const corr = spy.mock.calls.find(([u]) => String(u).includes("/corrigenda"));
      expect(corr).toBeDefined();
    });
    const corr = spy.mock.calls.find(([u]) => String(u).includes("/corrigenda"))!;
    const body = JSON.parse((corr[1] as RequestInit).body as string);
    expect(body.newBidClosingDate).toBe("2026-05-01");
    expect(body.description).toBe("Extended for more bidders");
  });

  it("keeps Save disabled until a file has actually finished uploading", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [] }));
    renderClient();
    await waitFor(() => expect(screen.getByText("No documents uploaded yet.")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Title *"), { target: { value: "NIT Document" } });
    expect(screen.getByRole("button", { name: "Save document" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Simulate completed upload" }));
    expect(screen.getByRole("button", { name: "Save document" })).toBeEnabled();
  });

  // Regression test for the core bug: the old handler base64-encoded the whole
  // file and sliced it to 200 characters before sending it as storageRef,
  // silently corrupting every real upload. The real S3 key that FileUpload's
  // presigned upload produced must be persisted unmodified.
  it("saves the document with the real upload key as storageRef, not a re-encoded/truncated value", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ data: [] })) // initial load
      .mockResolvedValueOnce(new Response("", { status: 200 })) // POST save
      .mockResolvedValueOnce(jsonResponse({ data: [] })); // reload after save

    renderClient();
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
      .mockResolvedValueOnce(jsonResponse({ data: [doc] })) // initial load
      .mockResolvedValueOnce(jsonResponse({ downloadUrl: "https://s3.example/signed?x=1", key: FAKE_KEY }));
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    renderClient();
    fireEvent.click(await screen.findByRole("button", { name: "Download" }));

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith("https://s3.example/signed?x=1", "_blank", "noopener,noreferrer");
    });
  });
});
