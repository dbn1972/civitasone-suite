import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { BatchDetail } from "./BatchDetail";
import { mapBatch, mapBatchFiles } from "@/lib/bulkScan/mappers";
import { BATCH, file, jsonResponse, renderIntl } from "./testHelpers";

const batchResult = (over: Record<string, unknown> = {}) => ({ data: mapBatch({ ...BATCH, ...over }), source: "api" as const });
const filesResult = (rows: unknown[]) => ({ data: mapBatchFiles({ data: rows, pagination: { hasMore: false, pageSize: 200 } })!, source: "api" as const });

const FILES = [
  file("enc", "failed", { failureReason: "ENCRYPTED_PDF", attempts: 1 }),
  file("dead", "failed", { failureReason: "MAX_ATTEMPTS", deadLetter: true, attempts: 5 }),
  file("held", "scan_pending", { nextAttemptAt: "2026-10-02T10:00:00.000Z" }),
  file("quar", "quarantined"),
  file("big", "failed", { failureReason: "FILE_TOO_LARGE" }),
  file("typ", "failed", { failureReason: "UNSUPPORTED_TYPE" }),
  file("rev", "needs_review"),
  file("lnk", "ready_to_file", { link: { state: "awaiting_approval", target: "hr_employee", targetId: "EMP-1" } }),
];

describe("BatchDetail", () => {
  const f = vi.fn();
  beforeEach(() => { f.mockReset(); vi.stubGlobal("fetch", f); });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("shows a human-readable reason for every failure code, quarantine and scan-pending hold", () => {
    renderIntl(<BatchDetail batchResult={batchResult({ counts: { failed: 4 } })} filesResult={filesResult(FILES)} />);
    expect(screen.getByText(/password protected/i)).toBeInTheDocument();
    expect(screen.getByText(/stopped\. Retrying will not help/i)).toBeInTheDocument();
    expect(screen.getByText(/malware scanner is unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/Quarantined: the malware scan found a threat/)).toBeInTheDocument();
    expect(screen.getByText(/larger than the allowed size per file/)).toBeInTheDocument();
    expect(screen.getByText(/file type is not supported/)).toBeInTheDocument();
    expect(screen.queryByText("ENCRYPTED_PDF")).not.toBeInTheDocument();
  });

  it("retry only on transient failures; skip where allowed; link status chip with text", () => {
    renderIntl(<BatchDetail batchResult={batchResult({ counts: { failed: 4 } })} filesResult={filesResult(FILES)} />);
    expect(screen.getByRole("button", { name: "Retry dead.pdf" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry enc.pdf" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip held.pdf" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Skip quar.pdf" })).not.toBeInTheDocument();
    expect(screen.getByText("Awaiting approval")).toHaveClass("pill");
    expect(screen.getByText(/HR employee file · EMP-1/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review rev.pdf" })).toHaveAttribute("href", "/admin/bulk-scan/review/b1/rev");
  });

  it("stale pending_upload rows can be skipped; an expired upload explains itself and is not retryable", () => {
    renderIntl(<BatchDetail batchResult={batchResult({ counts: { pending_upload: 1, failed: 1 } })} filesResult={filesResult([file("stale", "pending_upload"), file("exp", "failed", { failureReason: "UPLOAD_EXPIRED" })])} />);
    expect(screen.getByRole("button", { name: "Skip stale.pdf" })).toBeInTheDocument();
    expect(screen.getByText(/never finished within 24 hours/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry exp.pdf" })).not.toBeInTheDocument();
  });

  it("link chips: state plus a human reason from the shared codes, amounts from detail; null link shows none", () => {
    renderIntl(<BatchDetail batchResult={batchResult({ counts: { ready_to_file: 3 } })} filesResult={filesResult([
      file("m", "needs_review", { link: { state: "flagged_mismatch", target: "finance_payment", targetId: "P-1", reason: "AMOUNT_MISMATCH", detail: { expectedMinor: "125000", scannedMinor: "125001" } } }),
      file("n", "ready_to_file"),
    ])} />);
    expect(screen.getByText("Flagged: amount mismatch")).toHaveClass("pill");
    expect(screen.getByText("The amount on the document does not match the finance record.")).toBeInTheDocument();
    expect(screen.getByText("Record amount ₹1,250.00; scanned document ₹1,250.01.")).toBeInTheDocument();
    expect(screen.queryByText("AMOUNT_MISMATCH")).not.toBeInTheDocument();
    expect(screen.getAllByText("Flagged: amount mismatch")).toHaveLength(1);
  });

  it("skip goes through a confirm dialog and posts the optional reason", async () => {
    f.mockResolvedValue(jsonResponse(202, { id: "x", status: "accepted" }));
    renderIntl(<BatchDetail batchResult={batchResult({ counts: { failed: 1 } })} filesResult={filesResult([file("dead", "failed", { failureReason: "MAX_ATTEMPTS" })])} />);
    fireEvent.click(screen.getByRole("button", { name: "Skip dead.pdf" }));
    const dlg = await screen.findByRole("alertdialog");
    expect(f).not.toHaveBeenCalled();
    fireEvent.change(within(dlg).getByLabelText("Reason (optional)"), { target: { value: "bad scan" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(f.mock.calls[0]![0]).toBe("/api/proxy/v1/documents/bulk-scan/batches/b1/files/dead/skip");
    expect(JSON.parse(f.mock.calls[0]![1].body)).toEqual({ reason: "bad scan" });
  });

  it("a server refusal is explained in the dialog", async () => {
    f.mockResolvedValue(jsonResponse(409, { code: "NOT_RETRYABLE" }));
    renderIntl(<BatchDetail batchResult={batchResult({ counts: { failed: 1 } })} filesResult={filesResult([file("dead", "failed", { failureReason: "MAX_ATTEMPTS" })])} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry dead.pdf" }));
    const dlg = await screen.findByRole("alertdialog");
    fireEvent.click(within(dlg).getByRole("button", { name: "Retry" }));
    expect(await within(dlg).findByText("This file cannot be retried because the file itself was rejected.")).toBeInTheDocument();
  });

  it("polls with backoff while non-terminal and stops once everything settled", async () => {
    vi.useFakeTimers();
    const settled = { ...BATCH, status: "completed", counts: { filed: 2 }, progress: { total: 2, settled: 2, percent: 100 } };
    f.mockImplementation(async (url: string) => (/files/.test(url)
      ? jsonResponse(200, { data: [file("a", "filed"), file("b", "filed")], pagination: {} })
      : jsonResponse(200, settled)));
    renderIntl(<BatchDetail batchResult={batchResult({ counts: { queued: 2 } })} filesResult={filesResult([file("a", "queued"), file("b", "queued")])} />);
    expect(screen.getByText("This page refreshes automatically while files are being processed.")).toBeInTheDocument();
    expect(f).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
    expect(f).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Processing is finished or waiting for people.")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(120000); });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("a failed poll keeps the data, says it may be stale and backs off further", async () => {
    vi.useFakeTimers();
    f.mockResolvedValue(jsonResponse(500, {}));
    renderIntl(<BatchDetail batchResult={batchResult({ counts: { queued: 1 } })} filesResult={filesResult([file("a", "queued")])} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
    expect(screen.getByText(/may be out of date/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("The batch could not be refreshed.");
    expect(screen.getByText("a.pdf")).toBeInTheDocument();
    const calls = f.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(f.mock.calls.length).toBe(calls);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(f.mock.calls.length).toBeGreaterThan(calls);
  });

  it("distinguishes not found from a load error", () => {
    const { unmount } = renderIntl(<BatchDetail batchResult={{ data: null, source: "error", status: 404 }} filesResult={{ data: filesResult([]).data, source: "error" }} />);
    expect(screen.getByText("Batch not found")).toBeInTheDocument();
    unmount();
    renderIntl(<BatchDetail batchResult={{ data: null, source: "error", status: 500 }} filesResult={{ data: filesResult([]).data, source: "error" }} />);
    expect(screen.queryByText("Batch not found")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("empty batch vs files failing to load", () => {
    const { unmount } = renderIntl(<BatchDetail batchResult={batchResult({ counts: {}, fileCount: 0 })} filesResult={filesResult([])} />);
    expect(screen.getByText("No files in this batch yet")).toBeInTheDocument();
    unmount();
    renderIntl(<BatchDetail batchResult={batchResult()} filesResult={{ data: filesResult([]).data, source: "error", status: 500 }} />);
    expect(screen.queryByText("No files in this batch yet")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
