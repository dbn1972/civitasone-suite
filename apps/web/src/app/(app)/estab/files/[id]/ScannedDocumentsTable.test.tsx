import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

import { ScannedDocumentsTable } from "./ScannedDocumentsTable";
import type { EstabScannedDocument } from "@/lib/estab/scannedDocuments";

const DOC: EstabScannedDocument = {
  id: "r1", linkId: "l-1", documentId: "d-1111", batchId: "b-1", fileName: "order-scan.pdf", mimeType: "application/pdf", docType: "office_order",
  pageCount: 3, ocrConfidence: 0.91, piiFlags: ["pan"], textPreviewMasked: "Order no. ****12 refers", linkedBy: "u-1", approvedBy: null,
  filedAt: "2026-10-01T10:00:00.000Z",
};

function renderTable(rows: EstabScannedDocument[] = [DOC], locale: "en" | "hi" = "en") {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? enMessages : hiMessages}>
      <ScannedDocumentsTable rows={rows} />
    </NextIntlClientProvider>,
  );
}

describe("estab ScannedDocumentsTable", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  it("shows masked metadata, confidence and PII types only", () => {
    renderTable();
    expect(screen.getByText("order-scan.pdf")).toBeInTheDocument();
    expect(screen.getByText("Order no. ****12 refers")).toBeInTheDocument();
    expect(screen.getByText("91%")).toBeInTheDocument();
    expect(screen.getByText("Masked: PAN")).toBeInTheDocument();
    expect(screen.getByText("Office order")).toBeInTheDocument();
  });

  it("renders Hindi labels with the same placeholder", () => {
    renderTable([DOC], "hi");
    expect(screen.getByText("मास्क किया गया: PAN")).toBeInTheDocument();
    expect(screen.getByText("कार्यालय आदेश")).toBeInTheDocument();
    expect(screen.queryByText("office order")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "order-scan.pdf डाउनलोड करें" })).toBeInTheDocument();
  });

  it("downloads through the BFF document-service route and opens the presigned url", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ downloadUrl: "https://s3.example.com/x?sig=1" }), { status: 200, headers: { "content-type": "application/json" } }));
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: "Download order-scan.pdf" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://s3.example.com/x?sig=1", "_blank", "noopener,noreferrer"));
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/proxy/v1/documents/bulk-scan/files/d-1111/download?variant=original");
  });

  it("403 permission, 404 and a network error each get their own copy and open nothing", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderTable();
    const btn = () => screen.getByRole("button", { name: "Download order-scan.pdf" });
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 403, headers: { "content-type": "application/json" } }));
    fireEvent.click(btn());
    expect(await screen.findByRole("alert")).toHaveTextContent("You do not have permission to download this document.");
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 404, headers: { "content-type": "application/json" } }));
    fireEvent.click(btn());
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("This document was not found."));
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(btn());
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("The download failed. Try again."));
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
  });

  it("403 CLEARANCE_DENIED says the record is above the caller's clearance and offers no retry", async () => {
    renderTable();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code: "CLEARANCE_DENIED" }), { status: 403, headers: { "content-type": "application/json" } }));
    fireEvent.click(screen.getByRole("button", { name: "Download order-scan.pdf" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("above your clearance level");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("503 CLEARANCE_UNAVAILABLE offers Retry, and Retry repeats the download", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderTable();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code: "CLEARANCE_UNAVAILABLE" }), { status: 503, headers: { "content-type": "application/json" } }));
    fireEvent.click(screen.getByRole("button", { name: "Download order-scan.pdf" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("clearance check is temporarily unavailable");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ downloadUrl: "https://files.example/retry?sig=1" }), { status: 200, headers: { "content-type": "application/json" } }));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://files.example/retry?sig=1", "_blank", "noopener,noreferrer"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("clearance copy is localised (Hindi) and carries no status number or code", async () => {
    renderTable([DOC], "hi");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code: "CLEARANCE_UNAVAILABLE" }), { status: 503, headers: { "content-type": "application/json" } }));
    fireEvent.click(screen.getByRole("button", { name: /डाउनलोड/ }));
    const alert = await screen.findByRole("alert");
    expect(alert).not.toHaveTextContent(/503|CLEARANCE/);
    expect(alert.textContent ?? "").toMatch(/[\u0900-\u097F]/);
  });
});
