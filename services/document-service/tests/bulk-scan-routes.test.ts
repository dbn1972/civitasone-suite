/** bulk-scan HTTP surface (real DB, real memory queue + consumers): roles, 202 contract, maker-checker, limits, CQRS. */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { queue } from "../src/shared/infra.js";
import { sqlClient } from "../src/shared/db.js";
import { registerBulkScanConsumers } from "../src/modules/bulk-scan/consumer.js";
import { setPorts, resetPorts } from "../src/modules/bulk-scan/ports.js";
import { memoryStore, putSettings, USER1, USER2, USER3, newTenant, insertBatchRow, insertFileRow } from "./bulk-scan-helpers.js";

const SECRET = process.env.JWT_SECRET as string;
const P = "/v1/documents/bulk-scan";
const hdr = (sub: string, roles: string[], tid: string) => ({
  authorization: `Bearer ${signToken({ sub, roles, tid } as never, SECRET)}`,
  "x-tenant-id": tid,
});

const store = memoryStore();
let app: Awaited<ReturnType<typeof import("../src/app.js").buildApp>>;

beforeAll(async () => {
  setPorts({ store });
  registerBulkScanConsumers(queue);
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
});
afterAll(async () => {
  resetPorts();
  await app.close();
  await sqlClient.end();
});

const call = async (method: "GET" | "POST" | "PUT" | "DELETE", url: string, h: Record<string, string>, payload?: unknown) => {
  const r = await app.inject({ method, url, headers: h, ...(payload === undefined ? {} : { payload: payload as never }) });
  await queue.drain();
  return { status: r.statusCode, body: r.body ? (JSON.parse(r.body) as Record<string, unknown>) : {} };
};

describe("access control", () => {
  it("requires auth and an admin role on every route", async () => {
    const t = newTenant();
    expect((await app.inject({ method: "GET", url: `${P}/batches` })).statusCode).toBe(401);
    const user = hdr(USER1, ["document_user"], t);
    for (const [m, u] of [["GET", `${P}/batches`], ["GET", `${P}/settings`], ["GET", `${P}/profiles`], ["POST", `${P}/batches`]] as const) {
      expect((await call(m, u, user, m === "POST" ? { name: "x" } : undefined)).status, `${m} ${u}`).toBe(403);
    }
    expect((await call("GET", `${P}/batches`, hdr(USER1, ["document_admin"], t))).status).toBe(200);
  });
});

describe("settings maker-checker over HTTP", () => {
  it("PUT creates a change request; the maker cannot approve; another admin approves and it applies", async () => {
    const t = newTenant();
    const maker = hdr(USER1, ["document_admin"], t), checker = hdr(USER2, ["document_admin"], t);
    expect((await call("GET", `${P}/settings`, maker)).body).toMatchObject({ version: 0, settings: { dpi: 300, malwareFailClosed: true, duplicatePolicy: "skip" } });

    const put = await call("PUT", `${P}/settings`, maker, { settings: { dpi: 400 } });
    expect(put.status).toBe(202);
    const id = put.body.id as string;
    // nothing applied yet
    const pending = (await call("GET", `${P}/settings`, maker)).body as { settings: { dpi: number }; pendingRequests: { id: string; maker: string }[] };
    expect(pending.settings.dpi).toBe(300);
    expect(pending.pendingRequests.map((p) => p.id)).toEqual([id]);

    expect((await call("POST", `${P}/settings/change-requests/${id}/approve`, maker, {})).status).toBe(409);
    expect((await call("POST", `${P}/settings/change-requests/${id}/approve`, maker, {})).body.code).toBe("MAKER_CHECKER_VIOLATION");
    expect((await call("POST", `${P}/settings/change-requests/${id}/approve`, checker, {})).status).toBe(202);
    expect((await call("GET", `${P}/settings`, maker)).body).toMatchObject({ version: 1, settings: { dpi: 400 } });
    expect((await call("POST", `${P}/settings/change-requests/${id}/approve`, checker, {})).body.code).toBe("NOT_PENDING");
    expect((await call("GET", `${P}/settings/change-requests?status=approved`, maker)).body).toMatchObject({ data: [{ id, status: "approved" }] });
  });

  it("validates settings at the boundary (400 with field errors)", async () => {
    const t = newTenant();
    const r = await call("PUT", `${P}/settings`, hdr(USER1, ["document_admin"], t), { settings: { dpi: 9000, providerChain: [{ id: "x" }] } });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("VALIDATION_FAILED");
    expect((r.body.fieldErrors as { field: string }[]).map((f) => f.field)).toEqual(expect.arrayContaining(["settings.dpi"]));
  });

  it("turning malware fail-closed OFF: reason required (422), non-super approver forbidden (403), super_admin checker applies it", async () => {
    const t = newTenant();
    const maker = hdr(USER1, ["document_admin"], t);
    expect((await call("PUT", `${P}/settings`, maker, { settings: { malwareFailClosed: false } })).status).toBe(422);
    const put = await call("PUT", `${P}/settings`, maker, { settings: { malwareFailClosed: false }, reason: "scanner retired in UAT" });
    expect(put.status).toBe(202);
    const id = put.body.id as string;
    expect((await call("POST", `${P}/settings/change-requests/${id}/approve`, hdr(USER2, ["document_admin"], t), {})).status).toBe(403);
    expect((await call("POST", `${P}/settings/change-requests/${id}/approve`, hdr(USER2, ["super_admin"], t), {})).status).toBe(202);
    expect(((await call("GET", `${P}/settings`, maker)).body.settings as { malwareFailClosed: boolean }).malwareFailClosed).toBe(false);
  });

  it("reject needs a reason and a different user", async () => {
    const t = newTenant();
    const maker = hdr(USER1, ["document_admin"], t);
    const id = (await call("PUT", `${P}/settings`, maker, { settings: { concurrency: 3 } })).body.id as string;
    expect((await call("POST", `${P}/settings/change-requests/${id}/reject`, maker, { reason: "oops" })).status).toBe(409);
    expect((await call("POST", `${P}/settings/change-requests/${id}/reject`, hdr(USER3, ["document_admin"], t), {})).status).toBe(400);
    expect((await call("POST", `${P}/settings/change-requests/${id}/reject`, hdr(USER3, ["document_admin"], t), { reason: "not now" })).status).toBe(202);
    expect((await call("GET", `${P}/settings/change-requests`, maker)).body).toMatchObject({ data: [{ id, status: "rejected" }] });
  });

  it("is tenant scoped", async () => {
    const a = newTenant(), b = newTenant();
    const id = (await call("PUT", `${P}/settings`, hdr(USER1, ["document_admin"], a), { settings: { dpi: 350 } })).body.id as string;
    expect((await call("POST", `${P}/settings/change-requests/${id}/approve`, hdr(USER2, ["document_admin"], b), {})).status).toBe(404);
    expect((await call("GET", `${P}/settings/change-requests`, hdr(USER2, ["document_admin"], b))).body).toEqual({ data: [] });
  });
});

describe("profiles over HTTP", () => {
  it("create -> list -> update (optimistic) -> delete", async () => {
    const t = newTenant();
    const h = hdr(USER1, ["document_admin"], t);
    const c = await call("POST", `${P}/profiles`, h, { name: "Bills and vouchers", config: { dpi: 300 } });
    expect(c.status).toBe(202);
    const id = c.body.id as string;
    const list = (await call("GET", `${P}/profiles`, h)).body as { data: { id: string; name: string; version: number }[] };
    expect(list.data).toMatchObject([{ id, name: "Bills and vouchers", version: 1 }]);
    expect((await call("PUT", `${P}/profiles/${id}`, h, { expectedVersion: 1, config: { dpi: 350 } })).status).toBe(202);
    expect(((await call("GET", `${P}/profiles/${id}`, h)).body as { version: number }).version).toBe(2);
    expect((await call("PUT", `${P}/profiles/${randomUUID()}`, h, { expectedVersion: 1 })).status).toBe(404);
    expect((await call("POST", `${P}/profiles`, h, { name: "x", config: { malwareFailClosed: false } })).status).toBe(400);
    expect((await call("DELETE", `${P}/profiles/${id}`, h)).status).toBe(202);
    expect((await call("GET", `${P}/profiles/${id}`, h)).status).toBe(404);
  });
});

describe("batch lifecycle over HTTP", () => {
  it("create batch -> presigned upload URLs (limits enforced) -> complete", async () => {
    const t = newTenant();
    await putSettings(t, { limits: { maxFileBytes: 5000, maxFilesPerBatch: 3, maxBatchBytes: 9000 } });
    const h = hdr(USER1, ["document_admin"], t);
    const created = await call("POST", `${P}/batches`, h, { name: "Service books 1985", defaultTags: ["hr"] });
    expect(created.status).toBe(202);
    const batchId = created.body.id as string;
    const detail = await call("GET", `${P}/batches/${batchId}`, h);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ id: batchId, status: "open", fileCount: 0, defaultTags: ["hr"], progress: { total: 0, percent: 0 } });
    expect(((await call("GET", `${P}/batches`, h)).body.data as { id: string }[]).map((b) => b.id)).toEqual([batchId]);

    const files = [{ name: "a.pdf", mimeType: "application/pdf", sizeBytes: 100 }, { name: "b.png", mimeType: "image/png", sizeBytes: 200 }];
    const urls = await call("POST", `${P}/batches/${batchId}/files/upload-urls`, h, { files });
    expect(urls.status).toBe(202);
    const uploads = (urls.body.data as { uploads: { fileId: string; url: string; method: string; headers: Record<string, string> }[] }).uploads;
    expect(uploads).toHaveLength(2);
    expect(uploads[0]?.method).toBe("PUT");
    expect(uploads[0]?.url).toContain(`tenants/${t}/bulk-scan/${batchId}/${uploads[0]?.fileId}/original`);
    expect(uploads[1]?.headers["Content-Type"]).toBe("image/png");
    expect(((await call("GET", `${P}/batches/${batchId}`, h)).body as { fileCount: number; counts: Record<string, number> })).toMatchObject({ fileCount: 2, counts: { pending_upload: 2 } });

    // limits: per file, per batch count, per batch bytes
    const tooBig = await call("POST", `${P}/batches/${batchId}/files/upload-urls`, h, { files: [{ name: "x.pdf", mimeType: "application/pdf", sizeBytes: 5001 }] });
    expect(tooBig.status).toBe(422);
    expect(tooBig.body.code).toBe("FILE_TOO_LARGE");
    const tooMany = await call("POST", `${P}/batches/${batchId}/files/upload-urls`, h, { files: files.concat(files) });
    expect(tooMany.body.code).toBe("TOO_MANY_FILES");
    const tooManyBytes = await call("POST", `${P}/batches/${batchId}/files/upload-urls`, h, { files: [{ name: "x.pdf", mimeType: "application/pdf", sizeBytes: 5000 }, { name: "y.pdf", mimeType: "application/pdf", sizeBytes: 4900 }] });
    expect(tooManyBytes.status).toBe(422);

    // content types are allow-listed at the boundary
    expect((await call("POST", `${P}/batches/${batchId}/files/upload-urls`, h, { files: [{ name: "x.svg", mimeType: "image/svg+xml", sizeBytes: 5 }] })).status).toBe(400);

    // the client uploads, then completes: a bad object is rejected with a reason code, the good one proceeds to scanning
    const [good, bad] = uploads;
    store.objects.set(`tenants/${t}/bulk-scan/${batchId}/${good?.fileId}/original`, Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(91, 0x20)]));
    store.objects.set(`tenants/${t}/bulk-scan/${batchId}/${bad?.fileId}/original`, Buffer.alloc(200, 0x41));
    const done = await call("POST", `${P}/batches/${batchId}/files/complete`, h, { files: uploads.map((u) => ({ fileId: u.fileId })) });
    expect(done.status).toBe(202);
    const list = (await call("GET", `${P}/batches/${batchId}/files`, h)).body as { data: { id: string; state: string; failureReason: string | null; storageKey?: string }[] };
    const byId = new Map(list.data.map((f) => [f.id, f]));
    expect(byId.get(good?.fileId as string)?.state).toBe("scanning");
    expect(byId.get(bad?.fileId as string)).toMatchObject({ state: "failed", failureReason: "UNSUPPORTED_FILE_TYPE" });
    expect(JSON.stringify(list)).not.toContain("storageKey");                       // keys are never exposed
    expect((await call("GET", `${P}/batches/${batchId}/files?state=failed`, h)).body).toMatchObject({ data: [{ id: bad?.fileId }] });

    const one = await call("GET", `${P}/batches/${batchId}/files/${bad?.fileId}`, h);
    expect(one.status).toBe(200);
    expect((one.body.events as { toState: string }[]).map((e) => e.toState)).toEqual(["pending_upload", "failed"]);
    // permanent failures cannot be retried; a scanning file cannot be skipped
    expect((await call("POST", `${P}/batches/${batchId}/files/${bad?.fileId}/retry`, h, {})).body.code).toBe("NOT_RETRYABLE");
    expect((await call("POST", `${P}/batches/${batchId}/files/${good?.fileId}/skip`, h, {})).body.code).toBe("NOT_SKIPPABLE");

    // cancel
    expect((await call("POST", `${P}/batches/${batchId}/cancel`, h, {})).status).toBe(202);
    expect(((await call("GET", `${P}/batches/${batchId}`, h)).body as { status: string }).status).toBe("cancelled");
    expect((await call("POST", `${P}/batches/${batchId}/cancel`, h, {})).body.code).toBe("ALREADY_CANCELLED");
    expect((await call("POST", `${P}/batches/${batchId}/files/upload-urls`, h, { files })).body.code).toBe("BATCH_CANCELLED");
  });

  it("another tenant cannot see the batch or its files", async () => {
    const a = newTenant(), b = newTenant();
    const batchId = (await call("POST", `${P}/batches`, hdr(USER1, ["document_admin"], a), { name: "mine" })).body.id as string;
    const other = hdr(USER1, ["document_admin"], b);
    expect((await call("GET", `${P}/batches/${batchId}`, other)).status).toBe(404);
    expect((await call("GET", `${P}/batches/${batchId}/files`, other)).status).toBe(404);
    expect((await call("POST", `${P}/batches/${batchId}/files/upload-urls`, other, { files: [{ name: "a.pdf", mimeType: "application/pdf", sizeBytes: 1 }] })).status).toBe(404);
    expect(((await call("GET", `${P}/batches`, other)).body.data as unknown[])).toHaveLength(0);
  });

  it("rejects an unknown profile / doc type / disallowed link target before publishing", async () => {
    const t = newTenant();
    await putSettings(t, { allowedLinkTargets: ["hr_employee"] });
    const h = hdr(USER1, ["document_admin"], t);
    expect((await call("POST", `${P}/batches`, h, { name: "x", profileId: randomUUID() })).body.code).toBe("UNKNOWN_PROFILE");
    expect((await call("POST", `${P}/batches`, h, { name: "x", defaultDocType: "nope" })).body.code).toBe("UNKNOWN_DOC_TYPE");
    expect((await call("POST", `${P}/batches`, h, { name: "x", linkTarget: { target: "finance_bill" } })).body.code).toBe("LINK_TARGET_NOT_ALLOWED");
    expect((await call("POST", `${P}/batches`, h, { name: "x", linkTarget: { target: "hr_employee" } })).status).toBe(202);
  });
});

describe("CQRS: route files never write the database", () => {
  it.each(["routes.ts", "settings-routes.ts"])("%s has no DB writes or transactions", (f) => {
    const src = readFileSync(new URL(`../src/modules/bulk-scan/${f}`, import.meta.url), "utf8");
    expect(src).not.toMatch(/(?<!app)\.(insert|update|delete)\(/);   // Fastify `app.delete(` is a route, not a DB write
    expect(src).not.toMatch(/db\.transaction|\.transaction\(/);
    expect(src).not.toMatch(/from "\.\/consumer\.js"|from "\.\/pipeline\.js"|from "\.\/dispatcher\.js"/);
  });
});

describe("retry of a purged file", () => {
  it("is refused synchronously with 409 FILE_PURGED (the objects are gone); a normal failed file is still retryable", async () => {
    const t = newTenant();
    const h = hdr(USER1, ["document_admin"], t);
    const b = await insertBatchRow(t);
    const purged = await insertFileRow(t, b, "failed", { failureReason: "SCAN_UNAVAILABLE", retentionDeletedAt: new Date() });
    const r = await call("POST", `${P}/batches/${b}/files/${purged}/retry`, h, {});
    expect([r.status, r.body.code]).toEqual([409, "FILE_PURGED"]);
    const live = await insertFileRow(t, b, "failed", { failureReason: "SCAN_UNAVAILABLE" });
    expect((await call("POST", `${P}/batches/${b}/files/${live}/retry`, h, {})).status).toBe(202);
  });
});
