import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/headers", () => ({ cookies: () => ({ get: () => ({ value: "tok" }) }), headers: () => new Map() }));

import {
  getBulkScanBatch, getBulkScanBatches, getBulkScanBatchFiles, getBulkScanLinks, getBulkScanProfiles, getBulkScanProviders, getBulkScanReview,
  getBulkScanReviewQueue, getBulkScanSearch, getBulkScanSettings,
} from "./bulkScanLoaders";
import { reviewDetail, settingsObject } from "@/lib/bulkScan/fixtures";

const ok = (body: unknown): Response => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
const bad = (status: number, body: unknown = {}): Response => ({ ok: false, status, json: async () => body, clone() { return this; } }) as unknown as Response;

describe("bulk scan loaders", () => {
  const f = vi.fn();
  beforeEach(() => { process.env.CIVITASONE_API_BASE_URL = "http://gw"; f.mockReset(); vi.stubGlobal("fetch", f); });
  afterEach(() => vi.unstubAllGlobals());

  it("calls the document-service bulk-scan routes through the gateway with auth", async () => {
    f.mockResolvedValue(ok({ data: [], pagination: { hasMore: false, pageSize: 50 } }));
    await getBulkScanBatches({ status: "processing" });
    expect(f.mock.calls[0]![0]).toBe("http://gw/api/v1/documents/bulk-scan/batches?status=processing&limit=50");
    expect(f.mock.calls[0]![1].headers.authorization).toBe("Bearer tok");
    await getBulkScanBatchFiles("b 1");
    expect(f.mock.calls[1]![0]).toBe("http://gw/api/v1/documents/bulk-scan/batches/b%201/files?limit=200");
    await getBulkScanReviewQueue();
    expect(f.mock.calls[2]![0]).toContain("/review-queue?limit=100");
    await getBulkScanLinks("awaiting_approval");
    expect(f.mock.calls[3]![0]).toContain("/links?state=awaiting_approval&limit=100");
    await getBulkScanSearch("service book", "pay_slip");
    expect(f.mock.calls[4]![0]).toContain("/search?q=service+book&docType=pay_slip&limit=25");
    await getBulkScanReview("b1", "f1");
    expect(f.mock.calls[5]![0]).toContain("/batches/b1/files/f1/review");
  });

  it("maps successful payloads", async () => {
    f.mockResolvedValueOnce(ok({ data: [{ id: "b1", name: "B", status: "open", counts: { queued: 1 } }], pagination: { hasMore: true, pageSize: 50 } }));
    const r = await getBulkScanBatches();
    expect(r.source).toBe("api");
    expect(r.data.items[0]?.name).toBe("B");
    expect(r.data.page.hasMore).toBe(true);
    f.mockResolvedValueOnce(ok({ settings: settingsObject(), version: 2, degraded: false, pendingRequests: [] }));
    expect((await getBulkScanSettings()).data?.version).toBe(2);
    f.mockResolvedValueOnce(ok(reviewDetail()));
    expect((await getBulkScanReview("b1", "f1")).data?.file.version).toBe(3);
    f.mockResolvedValueOnce(ok({ data: [{ id: "p", name: "P", config: {} }] }));
    expect((await getBulkScanProfiles()).data).toHaveLength(1);
    f.mockResolvedValueOnce(ok({ data: [{ id: "tesseract", label: "T", available: true, sandbox: false }] }));
    expect((await getBulkScanProviders()).data[0]?.available).toBe(true);
  });

  it("a failed load is source:error with empty data, never an empty success; status is preserved", async () => {
    f.mockResolvedValueOnce(bad(500));
    const r = await getBulkScanBatches();
    expect(r).toMatchObject({ source: "error", status: 500 });
    expect(r.data.items).toEqual([]);
    f.mockResolvedValueOnce(bad(404, { code: "NOT_FOUND", message: "batch not found" }));
    const b = await getBulkScanBatch("x");
    expect(b).toMatchObject({ source: "error", status: 404, data: null });
    f.mockRejectedValueOnce(new Error("net"));
    expect((await getBulkScanBatches()).source).toBe("error");
  });

  it("an unexpected payload shape is an error too", async () => {
    f.mockResolvedValueOnce(ok({ unexpected: true }));
    expect((await getBulkScanBatches()).source).toBe("error");
    f.mockResolvedValueOnce(ok({ unexpected: true }));
    expect((await getBulkScanSettings()).source).toBe("error");
    f.mockResolvedValueOnce(ok({ unexpected: true }));
    expect((await getBulkScanReview("b", "f")).source).toBe("error");
  });
});
