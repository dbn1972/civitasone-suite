import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

import { ScannedDocumentsSection } from "./ScannedDocumentsSection";

const DOC = {
  id: "r1", linkId: "l-1", documentId: "d-1", batchId: "b-1", fileName: "office-order.pdf", mimeType: "application/pdf", docType: "office_order",
  pageCount: 2, ocrConfidence: 0.8, piiFlags: [], textPreviewMasked: null, linkedBy: "u", approvedBy: null, filedAt: "2026-10-01T10:00:00.000Z",
};

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function renderSection() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ScannedDocumentsSection fileId="file-1" backHref="/estab/list" />
    </NextIntlClientProvider>,
  );
}

describe("estab ScannedDocumentsSection (loaded after the page, UX-R5 perf)", () => {
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  it("the card is titled and shows a loading state until the read answers", async () => {
    let answer: (r: Response) => void = () => {};
    fetchMock.mockReturnValue(new Promise<Response>((r) => { answer = r; }));
    renderSection();
    expect(screen.getByText("Scanned documents")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: enMessages.estabScannedDocuments.loading })).toBeInTheDocument();
    answer(json({ data: [] }));
    expect(await screen.findByText("No scanned documents")).toBeInTheDocument();
  });

  it("reads the file scans through the browser proxy and lists them", async () => {
    fetchMock.mockResolvedValue(json({ data: [DOC] }));
    renderSection();
    expect(await screen.findByText("office-order.pdf")).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/proxy/v1/estab/files/file-1/scanned-documents");
  });

  it("a successful empty list shows the empty state", async () => {
    fetchMock.mockResolvedValue(json({ data: [] }));
    renderSection();
    expect(await screen.findByText("No scanned documents")).toBeInTheDocument();
  });

  it("a failed load is an error state, NOT the empty state", async () => {
    fetchMock.mockResolvedValue(json({ code: "INTERNAL", message: "internal error" }, 500));
    renderSection();
    expect(await screen.findByRole("button", { name: /try again|retry|refresh/i })).toBeInTheDocument();
    expect(screen.queryByText("No scanned documents")).not.toBeInTheDocument();
  });

  it("403 shows permission denied, not empty", async () => {
    fetchMock.mockResolvedValue(json({ code: "FORBIDDEN", message: "requires one of: estab_officer" }, 403));
    renderSection();
    // The standard permission copy (#1836) -- and never the role slugs the service put in its reason.
    expect(await screen.findByText(/You don\x27t have permission to do this\. Ask your administrator if you need access\./)).toBeInTheDocument();
    expect(screen.queryByText("No scanned documents")).not.toBeInTheDocument();
    expect(screen.queryByText(/estab_officer/)).not.toBeInTheDocument();
    expect(screen.queryByText(/requires one of/)).not.toBeInTheDocument();
  });
});
