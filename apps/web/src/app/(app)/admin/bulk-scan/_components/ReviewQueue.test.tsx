import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { ReviewQueue } from "./ReviewQueue";
import { mapReviewQueue } from "@/lib/bulkScan/mappers";
import { jsonResponse, renderIntl } from "./testHelpers";

const item = { batchId: "b1", fileId: "f1", originalName: "service-book.pdf", docType: "service_book", confidence: 0.55, reasons: ["LOW_CONFIDENCE", "MISSING_FIELD:date", "LINK_TARGET_NOT_FOUND"], piiFlags: ["aadhaar"], pageCount: 4, degradedPages: 1, updatedAt: "2026-10-01T10:00:00.000Z", version: 2 };
const res = (rows: unknown[]) => ({ data: mapReviewQueue({ data: rows, pagination: { hasMore: false, pageSize: 50 } })!, source: "api" as const });

describe("ReviewQueue", () => {
  const f = vi.fn();
  beforeEach(() => { f.mockReset(); vi.stubGlobal("fetch", f); });
  afterEach(() => vi.unstubAllGlobals());

  it("lists files with human-readable reasons, flags and a link into the workspace", () => {
    renderIntl(<ReviewQueue result={res([item])} />);
    expect(screen.getByRole("link", { name: "service-book.pdf" })).toHaveAttribute("href", "/admin/bulk-scan/review/b1/f1");
    expect(screen.getByText("A required field is missing: date.")).toBeInTheDocument();
    expect(screen.getByText("The record to link to was not found.")).toBeInTheDocument();
    expect(screen.getByText(/Personal data: aadhaar/)).toBeInTheDocument();
    expect(screen.getByText(/1 degraded pages/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Review next" })[0]).toHaveAttribute("href", "/admin/bulk-scan/review/b1/f1");
  });

  it("empty is not an error and an error is not empty", () => {
    const { unmount } = renderIntl(<ReviewQueue result={res([])} />);
    expect(screen.getByText("Nothing to review")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    unmount();
    renderIntl(<ReviewQueue result={{ data: res([]).data, source: "error", status: 500 }} />);
    expect(screen.queryByText("Nothing to review")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("filtering by reason refetches with the reason code", async () => {
    f.mockResolvedValue(jsonResponse(200, { data: [], pagination: {} }));
    renderIntl(<ReviewQueue result={res([item])} />);
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "PII_DETECTED" } });
    expect(await screen.findByText("Nothing with this reason")).toBeInTheDocument();
    expect(f.mock.calls[0]![0]).toContain("reason=PII_DETECTED");
  });
});
