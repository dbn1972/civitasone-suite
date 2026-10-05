import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { ScannedDocumentsSection } from "./ScannedDocumentsSection";
import type { HrScannedDocument } from "@/lib/hr/scannedDocuments";

const DOC: HrScannedDocument = {
  id: "r1", documentId: "d1", batchId: "b1", fileName: "service-book-p1.pdf", mimeType: "application/pdf",
  docType: "service_book", pageCount: 3, ocrConfidence: 0.912, piiFlags: ["aadhaar"],
  textPreviewMasked: "Service book of XXXX XXXX 1234", filedAt: "2026-03-01T10:00:00.000Z",
};

function ui(result: Parameters<typeof ScannedDocumentsSection>[0]["result"]) {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ScannedDocumentsSection result={result} backHref="/hr/employees" />
    </NextIntlClientProvider>
  );
}

describe("HR ScannedDocumentsSection", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  it("ready: human-readable type, confidence badge, masked preview, link to the review UI, no unlink button", () => {
    render(ui({ data: [DOC], source: "api" }));
    expect(screen.getByText("Service book")).toBeInTheDocument();
    expect(screen.queryByText("service_book")).not.toBeInTheDocument();
    expect(screen.getByText("91%")).toHaveClass("pill", "good");
    expect(screen.getByText("Service book of XXXX XXXX 1234")).toBeInTheDocument();
    expect(screen.getByText("Masked: Aadhaar")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /bulk scan review/i })).toHaveAttribute("href", "/admin/bulk-scan");
    expect(screen.queryByRole("button", { name: /unlink/i })).not.toBeInTheDocument();
  });

  it("empty: an honest empty state, not an error", () => {
    render(ui({ data: [], source: "api" }));
    expect(screen.getByText("No scanned documents")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("error: a failed load is NOT shown as empty", () => {
    render(ui({ data: [], source: "error" }));
    expect(screen.queryByText("No scanned documents")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("download: 403 and 404 show distinct copy; success opens the presigned url", async () => {
    render(ui({ data: [DOC], source: "api" }));
    const btn = screen.getByRole("button", { name: "Download service-book-p1.pdf" });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403, headers: new Headers(), json: async () => ({}) });
    fireEvent.click(btn);
    expect(await screen.findByRole("alert")).toHaveTextContent("You do not have permission to download this document.");
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, headers: new Headers(), json: async () => ({}) });
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("This document was not found."));
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ downloadUrl: "https://files.example/x" }) });
    fireEvent.click(btn);
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://files.example/x", "_blank", "noopener,noreferrer"));
    expect(fetchMock).toHaveBeenLastCalledWith("/api/proxy/v1/documents/bulk-scan/files/d1/download?variant=original", expect.anything());
    open.mockRestore();
  });

  it("403 CLEARANCE_DENIED has no retry; 503 CLEARANCE_UNAVAILABLE has a retry that repeats the download; a network error says so", async () => {
    render(ui({ data: [DOC], source: "api" }));
    const btn = screen.getByRole("button", { name: "Download service-book-p1.pdf" });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403, headers: new Headers(), json: async () => ({ code: "CLEARANCE_DENIED" }) });
    fireEvent.click(btn);
    expect(await screen.findByRole("alert")).toHaveTextContent("above your clearance level");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, headers: new Headers(), json: async () => ({ code: "CLEARANCE_UNAVAILABLE" }) });
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("clearance check is temporarily unavailable"));
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ downloadUrl: "https://files.example/r" }) });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://files.example/r", "_blank", "noopener,noreferrer"));
    open.mockRestore();
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("The download failed. Try again."));
  });

  it("Hindi: doc type and PII type are translated, not English fallbacks", () => {
    render(
      <NextIntlClientProvider locale="hi" messages={hiMessages}>
        <ScannedDocumentsSection result={{ data: [DOC], source: "api" }} backHref="/hr/employees" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("सेवा पुस्तिका")).toBeInTheDocument();
    expect(screen.getByText("मास्क किया गया: आधार")).toBeInTheDocument();
  });
});

describe("hrScannedDocuments i18n parity", () => {
  it("hi has every en key with the same placeholders", () => {
    const en = enMessages.hrScannedDocuments as Record<string, string>;
    const hi = hiMessages.hrScannedDocuments as Record<string, string>;
    expect(Object.keys(hi).sort()).toEqual(Object.keys(en).sort());
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const k of Object.keys(en)) expect(ph(hi[k]!)).toEqual(ph(en[k]!));
  });
});
