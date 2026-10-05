import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

import { ScannedDocumentsTable } from "./ScannedDocumentsTable";
import type { ScannedDocument } from "@/lib/finance/scannedDocuments";

const DOC: ScannedDocument = {
  id: "r1", documentId: "d-1111", batchId: "b-1", fileName: "bill-scan.pdf", mimeType: "application/pdf", docType: "bill_voucher",
  pageCount: 3, ocrConfidence: 0.91, piiFlags: ["pan"], textPreviewMasked: "Bill ****0091 total", matchedReference: "BILL/2026/0091",
  matchedAmountMinor: "1234567890123", linkId: "l-1", linkedBy: "u-1", approvedBy: null, filedAt: null, linkedAt: "2026-10-01T10:00:00.000Z",
};

function renderTable(rows: ScannedDocument[] = [DOC], locale: "en" | "hi" = "en") {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? enMessages : hiMessages}>
      <ScannedDocumentsTable rows={rows} />
    </NextIntlClientProvider>,
  );
}

describe("ScannedDocumentsTable", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  it("shows masked metadata, the exact paise amount via formatMoney, confidence and PII types only", () => {
    renderTable();
    expect(screen.getByText("bill-scan.pdf")).toBeInTheDocument();
    expect(screen.getByText("Bill ****0091 total")).toBeInTheDocument();
    expect(screen.getByText("₹12,34,56,78,901.23")).toBeInTheDocument();
    expect(screen.getByText("91%")).toBeInTheDocument();
    expect(screen.getByText("Masked: PAN")).toBeInTheDocument();
    expect(screen.getByText("Bill / voucher")).toBeInTheDocument();
    expect(screen.queryByText("bill voucher")).not.toBeInTheDocument();
  });

  it("renders Hindi labels with the same placeholders", () => {
    renderTable([DOC], "hi");
    expect(screen.getByText("मास्क किया गया: PAN")).toBeInTheDocument();
    expect(screen.getByText("बिल / वाउचर")).toBeInTheDocument();
    expect(screen.queryByText("bill voucher")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "bill-scan.pdf डाउनलोड करें" })).toBeInTheDocument();
  });

  it("download calls the BFF path for the document id and opens the presigned URL", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ downloadUrl: "https://files.example/x?sig=1" }), { status: 200, headers: { "content-type": "application/json" } }));
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: "Download bill-scan.pdf" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://files.example/x?sig=1", "_blank", "noopener,noreferrer"));
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/proxy/v1/documents/bulk-scan/files/d-1111/download?variant=original");
  });

  it("403 permission, 404 and a network error each get their own copy and open nothing", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderTable();
    const btn = () => screen.getByRole("button", { name: "Download bill-scan.pdf" });
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
    fireEvent.click(screen.getByRole("button", { name: "Download bill-scan.pdf" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("above your clearance level");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("503 CLEARANCE_UNAVAILABLE offers Retry, and Retry repeats the download", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderTable();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code: "CLEARANCE_UNAVAILABLE" }), { status: 503, headers: { "content-type": "application/json" } }));
    fireEvent.click(screen.getByRole("button", { name: "Download bill-scan.pdf" }));
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

  it("an unusable success body or a network error is a retryable failure, not a silent success", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ downloadUrl: "javascript:alert(1)" }), { status: 200, headers: { "content-type": "application/json" } }));
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: "Download bill-scan.pdf" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The download failed. Try again.");
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "Download bill-scan.pdf" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("The download failed. Try again."));
  });
});
