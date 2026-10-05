/** Resumable uploads, orphaned pending_upload handling, and the per-file link summary (real DB + HTTP). */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { outboxMessages } from "@civitasone/outbox";
import { signToken } from "@civitasone/auth";
import { queue } from "../src/shared/infra.js";
import { sqlClient } from "../src/shared/db.js";
import { registerBulkScanConsumers } from "../src/modules/bulk-scan/consumer.js";
import { setPorts, resetPorts } from "../src/modules/bulk-scan/ports.js";
import * as repo from "../src/modules/bulk-scan/repo.js";
import { links } from "../src/modules/bulk-scan/schema.js";
import { sweepPendingUploads, pendingUploadTtlMs } from "../src/modules/bulk-scan/upload-sweep.js";
import { createDispatcher } from "../src/modules/bulk-scan/dispatcher.js";
import { canTransition, SKIPPABLE_STATES } from "../src/modules/bulk-scan/state.js";
import { memoryStore, putSettings, newTenant, tenantTx, insertBatchRow, insertFileRow, USER1 } from "./bulk-scan-helpers.js";

const SECRET = process.env.JWT_SECRET as string;
const P = "/v1/documents/bulk-scan";
const hdr = (roles: string[], tid: string) => ({ authorization: `Bearer ${signToken({ sub: USER1, roles, tid } as never, SECRET)}`, "x-tenant-id": tid });
const store = memoryStore();
let app: Awaited<ReturnType<typeof import("../src/app.js").buildApp>>;

beforeAll(async () => {
  setPorts({ store });
  registerBulkScanConsumers(queue);
  app = await (await import("../src/app.js")).buildApp();
});
afterAll(async () => { resetPorts(); await app.close(); await sqlClient.end(); });

const call = async (method: "GET" | "POST", url: string, h: Record<string, string>, payload?: unknown) => {
  const r = await app.inject({ method, url, headers: h, ...(payload === undefined ? {} : { payload: payload as never }) });
  await queue.drain();
  return { status: r.statusCode, body: (r.body ? JSON.parse(r.body) : {}) as Record<string, any> };
};
const getFile = (t: string, id: string) => runWithTenant(t, () => repo.getFile(t, id)) as Promise<NonNullable<Awaited<ReturnType<typeof repo.getFile>>>>;

async function newBatchWithFile(t: string, h: Record<string, string>) {
  const batchId = (await call("POST", `${P}/batches`, h, { name: "resume" })).body.id as string;
  const urls = await call("POST", `${P}/batches/${batchId}/files/upload-urls`, h, { files: [{ name: "a.pdf", mimeType: "application/pdf", sizeBytes: 100 }] });
  const up = (urls.body.data.uploads as { fileId: string; url: string }[])[0]!;
  return { batchId, fileId: up.fileId, firstUrl: up.url };
}

describe("resumable uploads: re-issue a presigned PUT", () => {
  it("issues a fresh URL for the SAME server-chosen key for a pending_upload file", async () => {
    const t = newTenant(); const h = hdr(["document_admin"], t);
    const { batchId, fileId, firstUrl } = await newBatchWithFile(t, h);
    const r = await call("POST", `${P}/batches/${batchId}/files/${fileId}/upload-url`, h);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ fileId, method: "PUT", expiresInSeconds: 900, headers: { "Content-Type": "application/pdf" } });
    const key = `tenants/${t}/bulk-scan/${batchId}/${fileId}/original`;
    expect(r.body.data.url).toContain(key);
    expect(firstUrl).toContain(key);
    // a presign is not a write: the row is untouched
    expect((await getFile(t, fileId)).version).toBe(1);
  });

  it("404 for unknown / wrong-batch / other-tenant files; 403 without an admin role", async () => {
    const t = newTenant(); const h = hdr(["document_admin"], t);
    const { batchId, fileId } = await newBatchWithFile(t, h);
    const other = await newBatchWithFile(t, h);
    expect((await call("POST", `${P}/batches/${batchId}/files/${randomUUID()}/upload-url`, h)).status).toBe(404);
    expect((await call("POST", `${P}/batches/${other.batchId}/files/${fileId}/upload-url`, h)).status).toBe(404);
    expect((await call("POST", `${P}/batches/${batchId}/files/${fileId}/upload-url`, hdr(["document_admin"], newTenant()))).status).toBe(404);
    expect((await call("POST", `${P}/batches/${batchId}/files/${fileId}/upload-url`, hdr(["document_user"], t))).status).toBe(403);
  });

  it("409 NOT_PENDING_UPLOAD once the file has moved on (scanning, failed, cancelled)", async () => {
    const t = newTenant(); const h = hdr(["document_admin"], t);
    const { batchId, fileId } = await newBatchWithFile(t, h);
    store.objects.set(`tenants/${t}/bulk-scan/${batchId}/${fileId}/original`, Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(91, 0x20)]));
    await call("POST", `${P}/batches/${batchId}/files/complete`, h, { files: [{ fileId }] });
    expect((await getFile(t, fileId)).state).toBe("scanning");
    const r = await call("POST", `${P}/batches/${batchId}/files/${fileId}/upload-url`, h);
    expect(r).toMatchObject({ status: 409, body: { code: "NOT_PENDING_UPLOAD" } });

    const failed = await insertFileRow(t, batchId, "failed", { failureReason: "UPLOAD_MISSING" });
    expect((await call("POST", `${P}/batches/${batchId}/files/${failed}/upload-url`, h)).body.code).toBe("NOT_PENDING_UPLOAD");
    const pend = await newBatchWithFile(t, h);
    await call("POST", `${P}/batches/${pend.batchId}/cancel`, h, {});
    expect((await call("POST", `${P}/batches/${pend.batchId}/files/${pend.fileId}/upload-url`, h)).body.code).toBe("NOT_PENDING_UPLOAD");
  });

  it("enforces the file-size limit as at issue time", async () => {
    const t = newTenant(); const h = hdr(["document_admin"], t);
    const { batchId } = await newBatchWithFile(t, h);
    const big = await insertFileRow(t, batchId, "pending_upload", { declaredSizeBytes: 5000 });
    await putSettings(t, { limits: { maxFileBytes: 2048, maxFilesPerBatch: 10, maxBatchBytes: 100000 } });
    expect((await call("POST", `${P}/batches/${batchId}/files/${big}/upload-url`, h)).body.code).toBe("FILE_TOO_LARGE");
  });
});

describe("orphaned pending_upload rows", () => {
  it("can be skipped (state table, route, consumer) and the batch then settles", async () => {
    expect(canTransition("pending_upload", "skipped")).toBe(true);
    expect(SKIPPABLE_STATES).toContain("pending_upload");
    const t = newTenant(); const h = hdr(["document_admin"], t);
    const { batchId, fileId } = await newBatchWithFile(t, h);
    const r = await call("POST", `${P}/batches/${batchId}/files/${fileId}/skip`, h, { reason: "client abandoned" });
    expect(r.status).toBe(202);
    expect(await getFile(t, fileId)).toMatchObject({ state: "skipped" });
    const ev = (await runWithTenant(t, () => repo.listFileEvents(t, fileId))).map((e) => [e.fromState, e.toState]);
    expect(ev).toEqual([[null, "pending_upload"], ["pending_upload", "skipped"]]);
    expect((await runWithTenant(t, () => repo.getBatch(t, batchId)))?.status).toBe("completed");
    expect((await call("POST", `${P}/batches/${batchId}/files/${fileId}/upload-url`, h)).body.code).toBe("NOT_PENDING_UPLOAD");
  });

  const disc = (tenants: string[]) => ({
    async stalePendingUploads(before: Date, limit: number) {
      const out: { tenantId: string; fileId: string }[] = [];
      for (const t of tenants) out.push(...(await tenantTx(t, (tx) => repo.discoverStalePendingUploads(tx, before, limit))));
      return out;
    },
  });

  it("sweeper fails rows older than the TTL with UPLOAD_EXPIRED (audited, tenant scoped), leaves young ones, then batch settles", async () => {
    expect(pendingUploadTtlMs()).toBe(24 * 3_600_000);
    const t = newTenant();
    const batchId = await insertBatchRow(t, { fileCount: 2, status: "open" });
    const old = await insertFileRow(t, batchId, "pending_upload", { createdAt: new Date(Date.now() - 25 * 3_600_000) });
    const young = await insertFileRow(t, batchId, "pending_upload", { createdAt: new Date(Date.now() - 3_600_000) });
    const d = disc([t]);
    expect(await sweepPendingUploads(d, new Date())).toEqual({ expired: 1 });
    expect(await getFile(t, old)).toMatchObject({ state: "failed", failureReason: "UPLOAD_EXPIRED", deadLetter: false });
    expect((await getFile(t, young)).state).toBe("pending_upload");
    const audit = await tenantTx(t, (tx) => tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, t), eq(outboxMessages.topic, "audit.event.record"))));
    expect(audit.some((a) => (a.payload as { action?: string; resourceId?: string }).action === "upload_expired" && (a.payload as { resourceId?: string }).resourceId === old)).toBe(true);
    expect((await runWithTenant(t, () => repo.listFileEvents(t, old))).at(-1)).toMatchObject({ fromState: "pending_upload", toState: "failed", reason: "UPLOAD_EXPIRED" });
    expect(await sweepPendingUploads(d, new Date())).toEqual({ expired: 0 });         // idempotent
    // TTL is configurable; now the young one expires too and the batch completes
    expect(await sweepPendingUploads(d, new Date(), 60_000)).toEqual({ expired: 1 });
    expect((await runWithTenant(t, () => repo.getBatch(t, batchId)))?.status).toBe("completed");
    // not retryable (permanent): the operator must re-add the file
    const h = hdr(["document_admin"], t);
    expect((await call("POST", `${P}/batches/${batchId}/files/${old}/retry`, h, {})).body.code).toBe("NOT_RETRYABLE");
  });

  it("is part of the existing sweeper cycle (createDispatcher().sweepOnce) and never touches another tenant's rows", async () => {
    const a = newTenant(), b = newTenant();
    const ba = await insertBatchRow(a, { status: "open" }), bb = await insertBatchRow(b, { status: "open" });
    const fa = await insertFileRow(a, ba, "pending_upload", { createdAt: new Date(Date.now() - 48 * 3_600_000) });
    const fb = await insertFileRow(b, bb, "pending_upload");
    const discovery = { dueTenants: async () => [], dueFiles: async () => [], expiredLeases: async () => [], ...disc([a]) };
    const res = await createDispatcher({ discovery }).sweepOnce();
    expect(res).toMatchObject({ expiredUploads: 1 });
    expect((await getFile(a, fa)).state).toBe("failed");
    expect((await getFile(b, fb)).state).toBe("pending_upload");
  });
});

describe("per-file link summary on the files list and detail", () => {
  it("returns the latest link per file (single batched read), null when none, and tenant scoped", async () => {
    const t = newTenant(); const h = hdr(["document_admin"], t);
    const batchId = await insertBatchRow(t, { fileCount: 3 });
    const f1 = await insertFileRow(t, batchId, "ready_to_file");
    const f2 = await insertFileRow(t, batchId, "ready_to_file");
    const f3 = await insertFileRow(t, batchId, "ready_to_file");
    const mk = (fileId: string, o: Partial<typeof links.$inferInsert>) => tenantTx(t, (tx) => tx.insert(links).values({ id: randomUUID(), tenantId: t, fileId, target: "hr_employee", targetId: randomUUID(), requestedBy: USER1, ...o }).then(() => undefined));
    await mk(f1, { state: "rejected", resultReason: "TARGET_NOT_FOUND", createdAt: new Date(Date.now() - 60_000) });
    await mk(f1, { state: "flagged_mismatch", target: "finance_bill", targetId: "BILL-9", resultReason: "AMOUNT_MISMATCH", resultDetail: { expected: 100, found: 90 } });
    await mk(f2, { state: "linked", reason: "free text note" });
    const list = (await call("GET", `${P}/batches/${batchId}/files`, h)).body.data as { id: string; link: Record<string, unknown> | null }[];
    const by = new Map(list.map((f) => [f.id, f.link]));
    expect(by.get(f1)).toEqual({ state: "flagged_mismatch", target: "finance_bill", targetId: "BILL-9", reason: "AMOUNT_MISMATCH", detail: { expected: 100, found: 90 } });
    expect(by.get(f2)).toMatchObject({ state: "linked", target: "hr_employee", reason: null, detail: null });   // free-text note is NOT exposed as a code
    expect(by.get(f3)).toBeNull();
    const one = await call("GET", `${P}/batches/${batchId}/files/${f1}`, h);
    expect(one.body.link).toMatchObject({ state: "flagged_mismatch", reason: "AMOUNT_MISMATCH" });
    expect((await call("GET", `${P}/batches/${batchId}/files/${f3}`, h)).body.link).toBeNull();
    // another tenant sees nothing
    expect((await runWithTenant(newTenant(), () => repo.latestLinkSummaries(t, [f1, f2]))).size).toBe(0);
    expect((await runWithTenant(t, () => repo.latestLinkSummaries(t, []))).size).toBe(0);
  });
});
