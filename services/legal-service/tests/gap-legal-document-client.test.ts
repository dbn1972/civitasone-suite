/** GAP-LEGAL-CASES-DETAIL-01: the document-service HTTP client speaks the bulk-scan contract and hides upstream errors. */
import { describe, it, expect } from "vitest";
import { createHttpDocumentClient, DocumentServiceError } from "../src/shared/document-client.js";

const CTX = { tenantId: "11111111-aaaa-4000-8000-0000000d0a01", correlationId: "corr-1" };

function recorder(responses: Array<{ status: number; body?: unknown }>) {
  const seen: Array<{ url: string; method: string; headers: Record<string, string>; body?: string }> = [];
  let i = 0;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({ url, method: String(init.method), headers: init.headers as Record<string, string>, ...(init.body ? { body: String(init.body) } : {}) });
    const r = responses[Math.min(i++, responses.length - 1)]!;
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return { seen, fetchImpl };
}

describe("document-service client", () => {
  it("creates a batch with internal auth headers and waits for it to be readable", async () => {
    const { seen, fetchImpl } = recorder([{ status: 202, body: { id: "b1" } }, { status: 404 }, { status: 200, body: { id: "b1" } }]);
    const c = createHttpDocumentClient({ baseUrl: "http://doc:3049/", secret: "s3", fetchImpl, pollDelayMs: 1 });
    expect(await c.createBatch(CTX, "Affidavit WP/1")).toEqual({ batchId: "b1" });
    expect(seen[0]!.url).toBe("http://doc:3049/v1/documents/bulk-scan/batches");
    expect(seen[0]!.headers["x-internal"]).toBe("1");
    expect(seen[0]!.headers["x-tenant-id"]).toBe(CTX.tenantId);
    expect(seen[0]!.headers["x-service-secret"]).toBe("s3");
    expect(JSON.parse(seen[0]!.body!).defaultDocType).toBe("other");
    expect(seen).toHaveLength(3);
  });

  it("requests an upload URL and maps the download URL", async () => {
    const up = recorder([{ status: 202, body: { data: { uploads: [{ fileId: "f1", method: "PUT", url: "https://s/put", headers: { a: "b" }, expiresInSeconds: 900 }] } } }]);
    const c1 = createHttpDocumentClient({ baseUrl: "http://doc", secret: "s3", fetchImpl: up.fetchImpl });
    expect((await c1.requestUpload(CTX, "b1", { name: "a.pdf", mimeType: "application/pdf", sizeBytes: 10 })).fileId).toBe("f1");
    const dl = recorder([{ status: 200, body: { data: { downloadUrl: "https://s/get", expiresAt: "2099-01-01T00:00:00Z" } } }]);
    const c2 = createHttpDocumentClient({ baseUrl: "http://doc", secret: "s3", fetchImpl: dl.fetchImpl });
    expect((await c2.getDownloadUrl(CTX, "d1")).downloadUrl).toBe("https://s/get");
    expect(dl.seen[0]!.url).toContain("/files/d1/download");
  });

  it("is not_configured without a secret, unavailable on a 5xx or network error, rejected on a 4xx", async () => {
    const none = createHttpDocumentClient({ baseUrl: "http://doc", secret: "", fetchImpl: recorder([{ status: 200 }]).fetchImpl });
    await expect(none.completeUpload(CTX, "b", "f")).rejects.toMatchObject({ kind: "not_configured" });
    const five = createHttpDocumentClient({ baseUrl: "http://doc", secret: "x", fetchImpl: recorder([{ status: 503 }]).fetchImpl });
    await expect(five.completeUpload(CTX, "b", "f")).rejects.toMatchObject({ kind: "unavailable" });
    const four = createHttpDocumentClient({ baseUrl: "http://doc", secret: "x", fetchImpl: recorder([{ status: 422 }]).fetchImpl });
    await expect(four.completeUpload(CTX, "b", "f")).rejects.toMatchObject({ kind: "rejected" });
    const boom = createHttpDocumentClient({ baseUrl: "http://doc", secret: "x", fetchImpl: (async () => { throw new Error("ECONNREFUSED 10.1.1.1"); }) as unknown as typeof fetch });
    const err = await boom.completeUpload(CTX, "b", "f").catch((e) => e);
    expect(err).toBeInstanceOf(DocumentServiceError);
    expect(String(err.message)).not.toContain("10.1.1.1");
  });
});
