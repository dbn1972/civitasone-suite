import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test-utils/intl-render";
import { ImportBatchPanel } from "./ImportBatchPanel";
import type { ImportBatchSummary } from "../_data";

const failedBatch: ImportBatchSummary = { id: "b1", entityType: "org_unit", status: "completed", total: 5, inserted: 2, failed: 3, retryCount: 0, retryable: true };
const cleanBatch: ImportBatchSummary = { id: "b2", entityType: "org_unit", status: "completed", total: 1, inserted: 1, failed: 0, retryCount: 0, retryable: false };

describe("ImportBatchPanel (owner decision #23)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("everyone sees the CSV error report for a batch with failures, but only a clean batch has no report link", () => {
    render(<ImportBatchPanel batches={[failedBatch, cleanBatch]} canRetry={false} />);
    const link = screen.getByRole("link", { name: /Download error report for 3 failed rows/ });
    expect(link.getAttribute("href")).toBe("/api/proxy/v1/tenant/org/imports/b1/errors.csv");
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByText(/2 of 5 loaded · 3 failed/)).toBeInTheDocument();
  });

  it("a viewer who is not the migration admin has no retry control", () => {
    render(<ImportBatchPanel batches={[failedBatch]} canRetry={false} />);
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  });

  it("the migration admin retries once; the button is disabled while the request is pending", async () => {
    let resolve!: (r: Response) => void;
    const spy = vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise<Response>((r) => { resolve = r; }));
    render(<ImportBatchPanel batches={[failedBatch]} canRetry />);
    fireEvent.click(screen.getByRole("button", { name: /Retry 3 failed records/ }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Retry failed records") as HTMLButtonElement;
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/tenant/org/imports/b1/retry");
    expect(init.method).toBe("POST");
    expect((screen.getByRole("button", { name: /Retry 3 failed records/ }) as HTMLButtonElement).disabled).toBe(true);
    resolve(new Response("{}", { status: 202 }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Retry queued for 3 records/));
  });

  it("a refused retry shows a plain-language error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "NOTHING_TO_RETRY", message: "raw" }), { status: 409 }));
    render(<ImportBatchPanel batches={[failedBatch]} canRetry />);
    fireEvent.click(screen.getByRole("button", { name: /Retry 3 failed records/ }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Retry failed records") as HTMLButtonElement);
    await waitFor(() => expect(dialog.textContent).not.toContain("raw"));
    await waitFor(() => expect(dialog.textContent).toMatch(/try again|changed|conflict|already|not/i));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("distinguishes an empty list from a load failure", () => {
    const { rerender } = render(<ImportBatchPanel batches={[]} canRetry={false} />);
    expect(screen.getByText("No bulk imports yet.")).toBeInTheDocument();
    rerender(<ImportBatchPanel batches={[]} canRetry={false} loadFailed />);
    expect(screen.getByRole("alert").textContent).toMatch(/could not be loaded/);
    expect(screen.queryByText("No bulk imports yet.")).toBeNull();
  });
});
