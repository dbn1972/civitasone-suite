/**
 * OWNER DECISION #22 (TENANT-ADMIN-DATA-EXPORT-03): exports are real files in
 * object storage (packages/storage) behind signed links that expire in 15
 * minutes; CSV per entity, one JSON for a full export. Real Postgres, real
 * consumers, real routes; only the object store is replaced by an in-memory fake.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import type { Handler } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";

const store = new Map<string, string>();
const presign = vi.fn(async (o: { key: string; expiresIn?: number }) => `https://files.test/${o.key}?X-Amz-Expires=${o.expiresIn ?? 0}&X-Amz-Signature=sig`);
const put = vi.fn(async (key: string, body: string | Buffer) => {
  if (store.has("__fail__")) throw new Error("S3 exploded: secret-bucket-name unreachable");
  store.set(key, typeof body === "string" ? body : body.toString("utf8"));
});
vi.mock("@civitasone/storage", async (orig) => ({
  ...(await orig<typeof import("@civitasone/storage")>()),
  putObject: (k: string, b: string | Buffer, c: string) => put(k, b, c),
  presignedGetUrl: (o: { key: string; expiresIn?: number }) => presign(o),
}));

const { buildApp } = await import("../src/app.js");
const { db, sqlClient } = await import("../src/shared/db.js");
const { exportRequests } = await import("../src/modules/data-export/schema.js");
const { featureFlags } = await import("../src/modules/feature-flags/schema.js");
const { outboxMessages } = await import("../src/shared/outbox.js");
const { registerDataExportConsumers } = await import("../src/modules/data-export/consumer.js");
const { queue } = await import("../src/shared/infra.js");

const SECRET = process.env.JWT_SECRET as string;
const A = randomUUID();
const B = randomUUID();
const ACTOR = randomUUID();
const bearer = (tid: string, roles = ["tenant_admin"]) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, roles, tid } as never, SECRET)}` });

let app: FastifyInstance;

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 6000): Promise<T> {
  const end = Date.now() + ms; let last: T;
  do { last = await fn(); if (ok(last)) return last; await new Promise((r) => setTimeout(r, 80)); } while (Date.now() < end);
  return last;
}
const rowOf = (tid: string, id: string) => runWithTenant(tid, () => db.transaction((tx) => tx.select().from(exportRequests).where(eq(exportRequests.id, id)))).then((r) => r[0]);
async function request(tid: string, payload: Record<string, unknown>): Promise<string> {
  const r = await app.inject({ method: "POST", url: "/v1/admin/data-export", headers: bearer(tid), payload });
  expect(r.statusCode).toBe(202);
  return (r.json() as { id: string }).id;
}
const settled = async (tid: string, id: string) => waitFor(() => rowOf(tid, id), (r) => r?.status === "ready" || r?.status === "failed");

async function cleanup() {
  for (const t of [A, B]) await runWithTenant(t, () => db.transaction(async (tx) => {
    await tx.delete(exportRequests).where(eq(exportRequests.tenantId, t));
    await tx.delete(featureFlags).where(eq(featureFlags.tenantId, t));
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
  }));
}

beforeAll(async () => {
  const raw = queue.subscribe.bind(queue);
  queue.subscribe = ((topic: string, h: Handler) => raw(topic, withTenantConsumer(h) as Handler)) as typeof queue.subscribe;
  registerDataExportConsumers(queue);
  await queue.start();
  app = await buildApp();
  await cleanup();
  const flag = (tenantId: string, key: string, name: string) => ({ tenantId, key, name, description: "d", enabled: true, createdBy: ACTOR, updatedBy: ACTOR });
  await runWithTenant(A, () => db.transaction(async (tx) => {
    await tx.insert(featureFlags).values(flag(A, "beta-ui", "Beta UI, \"quoted\""));
    await tx.insert(featureFlags).values(flag(A, "inj", "=HYPERLINK(\"http://evil\")"));
  }));
  await runWithTenant(B, () => db.transaction((tx) => tx.insert(featureFlags).values(flag(B, "tenant-b-secret", "Other tenant flag"))));
});
beforeEach(() => { store.clear(); put.mockClear(); presign.mockClear(); });
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); });

describe("data export stores real files (owner decision #22)", () => {
  it("full JSON export writes ONE json object under the tenant prefix with this tenant's rows only", async () => {
    const id = await request(A, { type: "full", format: "json", purpose: "Annual statutory audit export" });
    const row = await settled(A, id);
    expect(row?.status).toBe("ready");
    expect([...store.keys()]).toEqual([`data-exports/${A}/${id}/export.json`]);
    const doc = JSON.parse(store.get(`data-exports/${A}/${id}/export.json`)!);
    expect(doc.tenantId).toBe(A);
    expect(doc.entities.feature_flags.map((f: { key: string }) => f.key).sort()).toEqual(["beta-ui", "inj"]);
    expect(JSON.stringify(doc)).not.toContain("tenant-b-secret");
    expect(Number(row?.fileSizeBytes)).toBeGreaterThan(0);
  });

  it("CSV export writes one CSV per entity, with a header, quoting and formula-injection guard", async () => {
    const id = await request(A, { type: "full", format: "csv", purpose: "Annual statutory audit export" });
    const row = await settled(A, id);
    expect(row?.status).toBe("ready");
    expect([...store.keys()].sort()).toEqual([
      `data-exports/${A}/${id}/custom_domains.csv`,
      `data-exports/${A}/${id}/department_templates.csv`,
      `data-exports/${A}/${id}/feature_flags.csv`,
    ]);
    const flags = store.get(`data-exports/${A}/${id}/feature_flags.csv`)!.replace(/^﻿/, "");
    const lines = flags.trim().split("\r\n");
    expect(lines[0]).toBe("id,key,name,description,enabled,rolloutPercent,killSwitch,owner,expiresAt,createdAt,updatedAt");
    expect(lines).toHaveLength(3);
    expect(flags).toContain('"Beta UI, ""quoted"""');
    expect(flags).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(flags).not.toContain("tenant-b-secret");
  });

  it("single-entity export produces just that entity; an unknown module/entity/format FAILS with a machine reason and writes nothing", async () => {
    const one = await request(A, { type: "entity", format: "csv", entityId: "feature_flags" });
    expect((await settled(A, one))?.status).toBe("ready");
    expect([...store.keys()]).toEqual([`data-exports/${A}/${one}/feature_flags.csv`]);

    store.clear(); put.mockClear();
    for (const [payload, reason] of [
      [{ type: "module", moduleFilter: "finance", format: "csv" }, "NO_EXPORTER_FOR_MODULE"],
      [{ type: "entity", format: "csv", entityId: "no_such_entity" }, "UNKNOWN_ENTITY"],
      [{ type: "entity", format: "pdf", entityId: "feature_flags" }, "UNSUPPORTED_FORMAT"],
    ] as const) {
      const id = await request(A, payload);
      const row = await settled(A, id);
      expect(row?.status).toBe("failed");
      expect(row?.failureReason).toBe(reason);
      expect(row?.files).toEqual([]);
    }
    expect(put).not.toHaveBeenCalled();
  });

  it("a storage failure marks the export failed with STORAGE_FAILED and never leaks the raw error", async () => {
    store.set("__fail__", "1");
    const id = await request(A, { type: "entity", format: "csv", entityId: "feature_flags" });
    const row = await settled(A, id);
    expect(row?.status).toBe("failed");
    expect(row?.failureReason).toBe("STORAGE_FAILED");
    const list = await app.inject({ method: "GET", url: "/v1/admin/data-export", headers: bearer(A) });
    expect(list.body).not.toContain("secret-bucket-name");
    store.delete("__fail__");
  });

  it("download returns links signed for 15 minutes, hides storage keys, and audits the issue", async () => {
    const id = await request(A, { type: "full", format: "csv", purpose: "Annual statutory audit export" });
    await settled(A, id);
    const before = (await runWithTenant(A, () => db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, A))))).length;
    const r = await app.inject({ method: "GET", url: `/v1/admin/data-export/${id}/download`, headers: bearer(A) });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { files: Array<{ entity: string; fileName: string; url: string }>; linkExpiresAt: string; downloadUrl: string };
    expect(body.files.map((f) => f.fileName).sort()).toEqual(["custom_domains.csv", "department_templates.csv", "feature_flags.csv"]);
    for (const f of body.files) expect(f.url).toContain("X-Amz-Expires=900");
    expect(presign.mock.calls.every(([o]) => o.expiresIn === 900)).toBe(true);
    const ttl = new Date(body.linkExpiresAt).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(14 * 60_000);
    expect(ttl).toBeLessThanOrEqual(15 * 60_000);
    expect(r.headers["cache-control"]).toBe("no-store");
    // The signed URL necessarily embeds the object path; no separate storage-key field may be exposed.
    for (const f of body.files) expect(Object.keys(f).sort()).toEqual(["entity", "fileName", "rowCount", "sizeBytes", "url"]);
    const after = await waitFor(
      () => runWithTenant(A, () => db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, A)))),
      (rows) => rows.length > before,
    );
    expect(after.some((m) => JSON.stringify(m.payload).includes('"action":"download"') && JSON.stringify(m.payload).includes(id))).toBe(true);
  });

  it("list rows carry a file summary but never a storage key", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/admin/data-export", headers: bearer(A) });
    expect(r.statusCode).toBe(200);
    expect(r.body).not.toContain("data-exports/");
    const gap = await app.inject({ method: "GET", url: "/v1/admin/data-exports", headers: bearer(A) });
    expect(gap.body).not.toContain("data-exports/");
  });

  it("another tenant cannot download (404) and a not-ready export is a 409", async () => {
    const id = await request(A, { type: "entity", format: "json", entityId: "feature_flags" });
    await settled(A, id);
    expect((await app.inject({ method: "GET", url: `/v1/admin/data-export/${id}/download`, headers: bearer(B) })).statusCode).toBe(404);
    const pending = randomUUID();
    await runWithTenant(A, () => db.transaction((tx) => tx.insert(exportRequests).values({ id: pending, tenantId: A, requestedBy: ACTOR, type: "full", format: "csv", status: "pending", createdBy: ACTOR, updatedBy: ACTOR })));
    expect((await app.inject({ method: "GET", url: `/v1/admin/data-export/${pending}/download`, headers: bearer(A) })).statusCode).toBe(409);
  });
});
