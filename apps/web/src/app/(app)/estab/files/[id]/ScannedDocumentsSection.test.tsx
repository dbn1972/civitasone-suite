import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
const loaderMock = vi.fn();
vi.mock("@/app/_data/loaders", () => ({ getEstabScannedDocuments: (...a: unknown[]) => loaderMock(...a) }));

import { ScannedDocumentsBody, ScannedDocumentsSection } from "./ScannedDocumentsSection";

const DOC = {
  id: "r1", linkId: "l-1", documentId: "d-1", batchId: "b-1", fileName: "office-order.pdf", mimeType: "application/pdf", docType: "office_order",
  pageCount: 2, ocrConfidence: 0.8, piiFlags: [], textPreviewMasked: null, linkedBy: "u", approvedBy: null, filedAt: "2026-10-01T10:00:00.000Z",
};

async function renderBody() {
  const ui = await ScannedDocumentsBody({ fileId: "file-1", backHref: "/estab/list" });
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

describe("estab ScannedDocumentsSection", () => {
  beforeEach(() => loaderMock.mockReset());

  it("the card is titled and wraps the body in Suspense (loading state)", async () => {
    const ui = (await ScannedDocumentsSection({ fileId: "file-1", backHref: "/estab/list" })) as { props: { title: string } };
    expect(ui.props.title).toBe("Scanned documents");
  });

  it("asks the loader for the file and lists the scans", async () => {
    loaderMock.mockResolvedValue({ data: [DOC], source: "api" });
    await renderBody();
    expect(loaderMock).toHaveBeenCalledWith("file-1");
    expect(screen.getByText("office-order.pdf")).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
  });

  it("a successful empty list shows the empty state", async () => {
    loaderMock.mockResolvedValue({ data: [], source: "api" });
    await renderBody();
    expect(screen.getByText("No scanned documents")).toBeInTheDocument();
  });

  it("a failed load is an error state, NOT the empty state", async () => {
    loaderMock.mockResolvedValue({ data: [], source: "error", status: 500 });
    await renderBody();
    expect(screen.queryByText("No scanned documents")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again|retry|refresh/i })).toBeInTheDocument();
  });

  it("403 shows permission denied, not empty", async () => {
    loaderMock.mockResolvedValue({ data: [], source: "error", status: 403, errorMessage: "requires one of: estab_officer" });
    await renderBody();
    expect(screen.queryByText("No scanned documents")).not.toBeInTheDocument();
    // The standard permission copy (#1836) -- and never the role slugs the service put in its reason.
    expect(screen.getByText(/You don't have permission to do this\. Ask your administrator if you need access\./)).toBeInTheDocument();
    expect(screen.queryByText(/estab_officer/)).not.toBeInTheDocument();
    expect(screen.queryByText(/requires one of/)).not.toBeInTheDocument();
  });
});
