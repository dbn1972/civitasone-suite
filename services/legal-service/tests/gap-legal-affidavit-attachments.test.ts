/**
 * GAP-LEGAL-CASES-DETAIL-01 (owner decision #9): affidavit attachments are stored
 * through document-service (its virus scan + OCR + retention pipeline, reached via
 * the bulk-scan API), and only legal roles can open them. legal-service holds the
 * case-side reference only; document-service is faked with a recording client.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { signToken } from "@civitasone/auth";
import { eq } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import type { Handler } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue, cache } from "../src/shared/infra.js";
import { legalCases } from "../src/modules/cases/schema.js";
import { legalCaseAttachments } from "../src/modules/attachments/schema.js";
import { registerAttachmentConsumers } from "../src/modules/attachments/consumer.js";
import { setDocumentClient, DocumentServiceError, type DocumentServiceClient } from "../src/shared/document-client.js";
import { outboxMessages } from "../src/shared/outbox.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "11111111-aaaa-4000-8000-0000000d0901";
const ACTOR = "00000000-aaaa-4000-8000-0000000d0901";
const CASE_ID = "22222222-bbbb-4000-8000-0000000d0901";
const BATCH = "44444444-dddd-4000-8000-0000000d0901";
const FILE = "55555555-eeee-4000-8000-0000000d0901";
const DOC = "66666666-ffff-4000-8000-0000000d0901";

const token = (roles: string[]) => signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET, 3600);
const auth = (roles: string[] = ["legal_officer"]) => ({ authorization: `Bearer ${token(roles)}`, "x-tenant-id": TENANT });
const drain = () => new Promise<void>((r) => setTimeout(r, 400));

let fileState: { state: string; filedDocumentId: string | null } = { state: "pending_upload", filedDocumentId: null };
const calls: string[] = [];
const fake: DocumentServiceClient = {
  async createBatch(_c, name) { calls.push(`createBatch:${name}`); return { batchId: BATCH }; },
  async requestUpload(_c, batchId, f) {
    calls.push(`requestUpload:${batchId}:${f.mimeType}`);
    return { fileId: FILE, method: "PUT", url: "https://store.example/put?sig=abc", headers: { "Content-Type": f.mimeType }, expiresInSeconds: 900 };
  },
  async completeUpload(_c, batchId, fileId) { calls.push(`complete:${batchId}:${fileId}`); },
  async getFileState() { return { ...fileState }; },
  async getDownloadUrl(_c, documentId) { calls.push(`download:${documentId}`); return { downloadUrl: "https://store.example/get?sig=xyz", expiresAt: "2099-01-01T00:00:00.000Z" }; },
};

async function wipe(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(legalCaseAttachments).where(eq(legalCaseAttachments.tenantId, TENANT));
    await tx.delete(legalCases).where(eq(legalCases.tenantId, TENANT));
  }));
}

let app: FastifyInstance;
beforeAll(async () => {
  await wipe();
  setDocumentClient(fake);
  const raw = queue.subscribe.bind(queue);
  queue.subscribe = ((topic: string, handler: Handler) => raw(topic, withTenantConsumer(handler) as Handler)) as typeof queue.subscribe;
  registerAttachmentConsumers(queue);
  app = await buildApp();
});
beforeEach(async () => {
  await wipe();
  calls.length = 0;
  fileState = { state: "pending_upload", filedDocumentId: null };
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(legalCases).values({
    id: CASE_ID, tenantId: TENANT, caseNo: "WP/901/2026", title: "Affidavit case", court: "High Court", createdBy: ACTOR, updatedBy: ACTOR,
  })));
  await cache.invalidateResource(TENANT, "case");
});
afterAll(async () => { await wipe(); await app.close(); await sqlClient.end(); });

const meta = { fileName: "counter-affidavit.pdf", mimeType: "application/pdf", sizeBytes: 123456 };
const url = (p = "") => `/v1/legal/cases/${CASE_ID}/affidavits${p}`;

describe("GAP-LEGAL-CASES-DETAIL-01 affidavit attachments via document-service (decision #9)", () => {
  it("only legal roles may start an upload: 401 without token, 403 for audit_officer and citizen", async () => {
    expect((await app.inject({ method: "POST", url: url(), payload: meta })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: url(), headers: auth(["audit_officer"]), payload: meta })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: url(), headers: auth(["citizen"]), payload: meta })).statusCode).toBe(403);
  });

  it("rejects an executable / unsupported file type and an oversize file", async () => {
    const bad = await app.inject({ method: "POST", url: url(), headers: auth(), payload: { ...meta, fileName: "x.exe", mimeType: "application/x-msdownload" } });
    expect(bad.statusCode).toBe(400);
    const big = await app.inject({ method: "POST", url: url(), headers: auth(), payload: { ...meta, sizeBytes: 500 * 1024 * 1024 } });
    expect(big.statusCode).toBe(400);
  });

  it("404 for an unknown case", async () => {
    const r = await app.inject({ method: "POST", url: `/v1/legal/cases/22222222-bbbb-4000-8000-0000000d09ff/affidavits`, headers: auth(), payload: meta });
    expect(r.statusCode).toBe(404);
  });

  it("202 returns a presigned upload target from document-service and persists an awaiting_upload reference + audit", async () => {
    const r = await app.inject({ method: "POST", url: url(), headers: auth(), payload: meta });
    expect(r.statusCode).toBe(202);
    const body = r.json() as { id: string; upload: { url: string; method: string } };
    expect(body.upload.method).toBe("PUT");
    expect(body.upload.url).toContain("store.example");
    expect(calls).toContain(`requestUpload:${BATCH}:application/pdf`);
    await drain();
    const rows = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(legalCaseAttachments).where(eq(legalCaseAttachments.id, body.id))));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("awaiting_upload");
    expect(rows[0]!.docBatchId).toBe(BATCH);
    expect(rows[0]!.createdBy).toBe(ACTOR);
    const audits = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))));
    expect(audits.some((a) => (a.payload as { action?: string; resourceType?: string }).action === "create" && (a.payload as { resourceType?: string }).resourceType === "affidavit")).toBe(true);
  });

  async function startAndComplete(): Promise<string> {
    const s = await app.inject({ method: "POST", url: url(), headers: auth(), payload: meta });
    const id = (s.json() as { id: string }).id;
    await drain();
    const c = await app.inject({ method: "POST", url: url(`/${id}/complete`), headers: auth(), payload: {} });
    expect(c.statusCode).toBe(202);
    await drain();
    return id;
  }

  it("complete tells document-service the upload finished and moves the reference to processing", async () => {
    const id = await startAndComplete();
    expect(calls).toContain(`complete:${BATCH}:${FILE}`);
    const rows = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(legalCaseAttachments).where(eq(legalCaseAttachments.id, id))));
    expect(rows[0]!.status).toBe("processing");
  });

  it("list reflects document-service state and stores the filed document id once filed", async () => {
    const id = await startAndComplete();
    fileState = { state: "needs_review", filedDocumentId: null };
    const mid = await app.inject({ method: "GET", url: url(), headers: auth() });
    expect(mid.statusCode).toBe(200);
    expect((mid.json() as { items: Array<{ id: string; status: string }> }).items.find((i) => i.id === id)!.status).toBe("processing");

    fileState = { state: "filed", filedDocumentId: DOC };
    const done = await app.inject({ method: "GET", url: url(), headers: auth() });
    expect((done.json() as { items: Array<{ id: string; status: string }> }).items.find((i) => i.id === id)!.status).toBe("filed");
    await drain();
    const rows = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(legalCaseAttachments).where(eq(legalCaseAttachments.id, id))));
    expect(rows[0]!.status).toBe("filed");
    expect(rows[0]!.documentId).toBe(DOC);
  });

  it("an infected upload is shown as quarantined and can never be opened", async () => {
    const id = await startAndComplete();
    fileState = { state: "quarantined", filedDocumentId: null };
    const l = await app.inject({ method: "GET", url: url(), headers: auth() });
    expect((l.json() as { items: Array<{ id: string; status: string }> }).items.find((i) => i.id === id)!.status).toBe("quarantined");
    const d = await app.inject({ method: "GET", url: url(`/${id}/download`), headers: auth() });
    expect(d.statusCode).toBe(409);
  });

  it("only legal roles open a filed affidavit; the open is audited with the opener", async () => {
    const id = await startAndComplete();
    fileState = { state: "filed", filedDocumentId: DOC };
    await app.inject({ method: "GET", url: url(), headers: auth() });
    await drain();

    expect((await app.inject({ method: "GET", url: url(`/${id}/download`), headers: auth(["audit_officer"]) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: url(`/${id}/download`), headers: auth(["finance_admin"]) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: url(`/${id}/download`) })).statusCode).toBe(401);

    const ok = await app.inject({ method: "GET", url: url(`/${id}/download`), headers: auth() });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as { downloadUrl: string }).downloadUrl).toContain("store.example");
    expect(calls).toContain(`download:${DOC}`);
    await drain();
    const audits = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))));
    const opened = audits.filter((a) => (a.payload as { action?: string }).action === "open" && (a.payload as { resourceType?: string }).resourceType === "affidavit");
    expect(opened).toHaveLength(1);
    expect(opened[0]!.actorId).toBe(ACTOR);
  });

  it("an affidavit of another case/tenant id is a 404, not a leak", async () => {
    const r = await app.inject({ method: "GET", url: url(`/77777777-aaaa-4000-8000-0000000d09ff/download`), headers: auth() });
    expect(r.statusCode).toBe(404);
  });

  it("a document-service outage is a retryable 503 with no raw error text", async () => {
    setDocumentClient({ ...fake, async createBatch() { throw new DocumentServiceError("unavailable", "connect ECONNREFUSED 10.0.0.9:3049 secret-detail"); } });
    const r = await app.inject({ method: "POST", url: url(), headers: auth(), payload: meta });
    setDocumentClient(fake);
    expect(r.statusCode).toBe(503);
    expect(JSON.stringify(r.json())).not.toContain("ECONNREFUSED");
    expect((r.json() as { retryable: boolean }).retryable).toBe(true);
  });
});
