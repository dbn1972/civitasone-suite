/**
 * document-service CLIENT (GAP-LEGAL-CASES-DETAIL-01, owner decision #9).
 *
 * legal-service never stores affidavit bytes itself. It registers them with
 * document-service's bulk-scan pipeline (presigned upload, ClamAV scan, OCR,
 * filing, retention) over the platform's service-to-service auth
 * (x-internal + x-tenant-id + x-service-secret = INTERNAL_SERVICE_SECRET) and keeps
 * only a reference. Callers get a typed error and NEVER the upstream message:
 * outages are logged server-side and surfaced as a generic retryable 503.
 */
import { pino } from "pino";

const log = pino({ name: "legal-document-client" });
const P = "/v1/documents/bulk-scan";

export interface DocCallCtx { tenantId: string; correlationId: string }
export interface UploadTarget { fileId: string; method: "PUT"; url: string; headers: Record<string, string>; expiresInSeconds: number }
export interface RemoteFileState { state: string; filedDocumentId: string | null }

export interface DocumentServiceClient {
  createBatch(ctx: DocCallCtx, name: string): Promise<{ batchId: string }>;
  requestUpload(ctx: DocCallCtx, batchId: string, file: { name: string; mimeType: string; sizeBytes: number }): Promise<UploadTarget>;
  completeUpload(ctx: DocCallCtx, batchId: string, fileId: string): Promise<void>;
  getFileState(ctx: DocCallCtx, batchId: string, fileId: string): Promise<RemoteFileState>;
  getDownloadUrl(ctx: DocCallCtx, documentId: string): Promise<{ downloadUrl: string; expiresAt: string }>;
}

export class DocumentServiceError extends Error {
  constructor(public readonly kind: "unavailable" | "not_configured" | "rejected", detail: string, public readonly upstreamStatus?: number) {
    super(detail);
    this.name = "DocumentServiceError";
  }
}

export interface HttpClientOptions { baseUrl?: string; secret?: string; fetchImpl?: typeof fetch; timeoutMs?: number; pollAttempts?: number; pollDelayMs?: number }

export function createHttpDocumentClient(opts: HttpClientOptions = {}): DocumentServiceClient {
  const base = (opts.baseUrl ?? process.env.DOCUMENT_SERVICE_URL ?? "http://127.0.0.1:3049").replace(/\/$/, "");
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? Number(process.env.DOCUMENT_SERVICE_TIMEOUT_MS ?? 8000);
  const attempts = opts.pollAttempts ?? 15;
  const delayMs = opts.pollDelayMs ?? 200;

  async function call<T>(ctx: DocCallCtx, method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; json: T | null }> {
    const secret = opts.secret ?? process.env.INTERNAL_SERVICE_SECRET ?? "";
    if (!secret) throw new DocumentServiceError("not_configured", "INTERNAL_SERVICE_SECRET is not set");
    try {
      const res = await doFetch(`${base}${path}`, {
        method,
        headers: {
          "x-internal": "1", "x-tenant-id": ctx.tenantId, "x-service-secret": secret,
          "x-internal-caller": "legal-service", "x-correlation-id": ctx.correlationId,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "manual",
      });
      const text = await res.text();
      let json: T | null = null;
      try { json = text ? (JSON.parse(text) as T) : null; } catch { json = null; }
      return { status: res.status, json };
    } catch (err) {
      if (err instanceof DocumentServiceError) throw err;
      log.error({ err: err instanceof Error ? err.message : String(err), path }, "document-service call failed");
      throw new DocumentServiceError("unavailable", "document-service unreachable");
    }
  }

  const ok = (status: number): boolean => status >= 200 && status < 300;
  const fail = (path: string, status: number): DocumentServiceError => {
    log.warn({ path, status }, "document-service returned a non-success status");
    return new DocumentServiceError(status >= 500 || status === 429 ? "unavailable" : "rejected", `document-service ${status}`, status);
  };
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  return {
    async createBatch(ctx, name) {
      const created = await call<{ id?: string }>(ctx, "POST", `${P}/batches`, {
        name: name.slice(0, 200), defaultTags: ["legal", "affidavit"], defaultDocType: "other",
      });
      if (!ok(created.status) || !created.json?.id) throw fail(`${P}/batches`, created.status);
      const batchId = created.json.id;
      // Batch creation is a 202 command in document-service: wait until the batch is readable.
      for (let i = 0; i < attempts; i++) {
        const got = await call(ctx, "GET", `${P}/batches/${batchId}`);
        if (ok(got.status)) return { batchId };
        if (got.status !== 404) throw fail(`${P}/batches/:id`, got.status);
        await sleep(delayMs);
      }
      throw new DocumentServiceError("unavailable", "batch not visible in time");
    },
    async requestUpload(ctx, batchId, file) {
      const r = await call<{ data?: { uploads?: Array<{ fileId: string; method: "PUT"; url: string; headers: Record<string, string>; expiresInSeconds: number }> } }>(
        ctx, "POST", `${P}/batches/${batchId}/files/upload-urls`, { files: [{ name: file.name, mimeType: file.mimeType, sizeBytes: file.sizeBytes }] });
      const u = r.json?.data?.uploads?.[0];
      if (!ok(r.status) || !u) throw fail(`${P}/batches/:id/files/upload-urls`, r.status);
      return { fileId: u.fileId, method: "PUT", url: u.url, headers: u.headers ?? {}, expiresInSeconds: u.expiresInSeconds };
    },
    async completeUpload(ctx, batchId, fileId) {
      const r = await call(ctx, "POST", `${P}/batches/${batchId}/files/complete`, { files: [{ fileId }] });
      if (!ok(r.status)) throw fail(`${P}/batches/:id/files/complete`, r.status);
    },
    async getFileState(ctx, batchId, fileId) {
      const r = await call<{ state?: string; filedDocumentId?: string | null }>(ctx, "GET", `${P}/batches/${batchId}/files/${fileId}`);
      if (!ok(r.status) || !r.json?.state) throw fail(`${P}/batches/:id/files/:fileId`, r.status);
      return { state: r.json.state, filedDocumentId: r.json.filedDocumentId ?? null };
    },
    async getDownloadUrl(ctx, documentId) {
      const r = await call<{ data?: { downloadUrl?: string; expiresAt?: string } }>(ctx, "GET", `${P}/files/${documentId}/download?variant=original`);
      const d = r.json?.data;
      if (!ok(r.status) || !d?.downloadUrl) throw fail(`${P}/files/:documentId/download`, r.status);
      return { downloadUrl: d.downloadUrl, expiresAt: d.expiresAt ?? "" };
    },
  };
}

let current: DocumentServiceClient | null = null;
export function getDocumentClient(): DocumentServiceClient {
  current ??= createHttpDocumentClient();
  return current;
}
/** Test seam: swap the client (restore with setDocumentClient(null)). */
export function setDocumentClient(c: DocumentServiceClient | null): void { current = c; }
