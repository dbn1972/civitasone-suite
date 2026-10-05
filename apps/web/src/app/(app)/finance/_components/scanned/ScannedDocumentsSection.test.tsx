import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
const loaderMock = vi.fn();
vi.mock("@/app/_data/loaders", () => ({ getFinanceScannedDocuments: (...a: unknown[]) => loaderMock(...a) }));

import { ScannedDocumentsBody, ScannedDocumentsSection } from "./ScannedDocumentsSection";

const DOC = {
  id: "r1", documentId: "d-1", batchId: "b-1", fileName: "scan.pdf", mimeType: null, docType: "bill_voucher", pageCount: 1, ocrConfidence: 0.8,
  piiFlags: [], textPreviewMasked: null, matchedReference: "B-1", matchedAmountMinor: "5000", linkId: "l", linkedBy: "u", approvedBy: null, filedAt: null, linkedAt: "2026-10-01T10:00:00.000Z",
};

async function renderBody(kind: "payments" | "bills" | "vouchers" = "bills") {
  const ui = await ScannedDocumentsBody({ kind, id: "abc", backHref: "/finance" });
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

describe("ScannedDocumentsSection", () => {
  beforeEach(() => loaderMock.mockReset());

  it("the card is titled and wraps the body in Suspense (loading state)", async () => {
    const ui = (await ScannedDocumentsSection({ kind: "bills", id: "abc", backHref: "/finance" })) as { props: { title: string } };
    expect(ui.props.title).toBe("Scanned documents");
  });

  it("asks the loader for the right kind + id and lists the attachments", async () => {
    loaderMock.mockResolvedValue({ data: [DOC], source: "api" });
    await renderBody("payments");
    expect(loaderMock).toHaveBeenCalledWith("payments", "abc");
    expect(screen.getByText("scan.pdf")).toBeInTheDocument();
    expect(screen.getByText("\u20b950.00")).toBeInTheDocument();
  });

  it("a successful empty list shows the empty state with a kind-specific message", async () => {
    loaderMock.mockResolvedValue({ data: [], source: "api" });
    await renderBody("bills");
    expect(screen.getByText("No scanned documents")).toBeInTheDocument();
    expect(screen.getByText(/No scanned bill has been attached/)).toBeInTheDocument();
  });

  it("a failed load is an error state, NOT the empty state", async () => {
    loaderMock.mockResolvedValue({ data: [], source: "error", status: 500 });
    await renderBody("bills");
    expect(screen.queryByText("No scanned documents")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again|retry|refresh/i })).toBeInTheDocument();
  });

  it("403 shows the permission-denied state, not empty and not a generic error", async () => {
    loaderMock.mockResolvedValue({ data: [], source: "error", status: 403, errorMessage: "requires one of: finance_officer" });
    await renderBody("payments");
    expect(screen.queryByText("No scanned documents")).not.toBeInTheDocument();
    // The standard permission copy (#1836) -- and never the role slugs the service put in its reason.
    expect(screen.getByText(/You don't have permission to do this\. Ask your administrator if you need access\./)).toBeInTheDocument();
    expect(screen.queryByText(/finance_officer/)).not.toBeInTheDocument();
    expect(screen.queryByText(/requires one of/)).not.toBeInTheDocument();
  });
});
