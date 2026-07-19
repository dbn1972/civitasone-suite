/**
 * HTTP route coverage for the exports module — GET status/download/verify and
 * POST create. audit.test.ts already covers PII gating on POST and a full
 * consumer-driven signed-export pipeline test (pure signing + DB completion);
 * this file drives that same consumer pipeline to get a REAL completed export
 * row + on-disk artifact, then exercises the route layer (routes.ts) against it:
 * auth (401/403), not-found (404), the status DTO shape, the tokenized download
 * (including cross-tenant RLS scoping), and the integrity /verify endpoint.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

/**
 * Test-harness fix (mirrors audit.test.ts / para.test.ts): a bare `new
 * MemoryQueue()` does not auto-wrap subscribed handlers with
 * `withTenantConsumer`, so the consumer's `db.transaction()` calls would run
 * with no RLS GUC set. Wrap subscribe so every handler gets the tenant scope.
 */
function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
function token(roles: string[], tenantId: string, actorId: string): string {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-1" }, SECRET, 3600);
}

const EXPORT_DIR = process.env.EXPORT_DIR ?? "/tmp/audit-exports";

// The requester tenant/actor: the completed export's createdBy MUST equal
// ACTOR for canDownload() (routes.ts) to expose the download token.
const TENANT = randomUUID();
const ACTOR = randomUUID();

// A wholly different tenant, used to prove RLS scoping (findByIdTx filters by
// ctx.tenantId) blocks cross-tenant access even with an EXPORT_ROLES role and
// the correct download token.
const OTHER_TENANT = randomUUID();
const OTHER_ACTOR = randomUUID();

let app: FastifyInstance;
let db: typeof import("../src/shared/db.js")["db"];
let sqlClient: typeof import("../src/shared/db.js")["sqlClient"];
let auditExports: typeof import("../src/modules/exports/schema.js")["auditExports"];
let registerAuditConsumers: typeof import("../src/modules/events/consumer.js")["registerAuditConsumers"];
let registerExportConsumers: typeof import("../src/modules/exports/consumer.js")["registerExportConsumers"];

let exportId: string;
let downloadToken: string;
let signedUrl: string;

beforeAll(async () => {
  app = await buildApp();

  ({ db, sqlClient } = await import("../src/shared/db.js"));
  ({ auditExports } = await import("../src/modules/exports/schema.js"));
  ({ registerAuditConsumers } = await import("../src/modules/events/consumer.js"));
  ({ registerExportConsumers } = await import("../src/modules/exports/consumer.js"));

  // Drive a real export through the consumer end-to-end (mirrors audit.test.ts's
  // "SIGNED EXPORT" test) so we have a genuine status="completed" row with a
  // signedUrl/downloadToken/contentSha256/signature to test the GET routes against.
  exportId = randomUUID();
  const q = wireTenantAwareQueue(new MemoryQueue());
  registerAuditConsumers(q); // for the audit-trail event the export emits
  registerExportConsumers(q);
  await q.start();

  await q.publish("audit.export.create", {
    messageId: exportId, type: "audit.export.create", tenantId: TENANT, actorId: ACTOR,
    correlationId: randomUUID(), schemaVersion: "1.0",
    payload: {
      id: exportId, tenantId: TENANT,
      from: "2020-01-01T00:00:00.000Z", to: "2035-01-01T00:00:00.000Z",
      format: "json", includePii: false, roles: ["audit_admin"],
    },
  });
  await new Promise((r) => setTimeout(r, 1200));
  await q.stop();

  const rows = await runWithTenant(TENANT, () =>
    db.transaction((tx) => tx.select().from(auditExports).where(eq(auditExports.id, exportId))),
  );
  const row = rows[0];
  if (!row || row.status !== "completed" || !row.signedUrl || !row.downloadToken) {
    throw new Error(
      `test setup failed: export ${exportId} did not complete (status=${row?.status ?? "missing"})`,
    );
  }
  signedUrl = row.signedUrl;
  downloadToken = row.downloadToken;
});

afterAll(async () => {
  await runWithTenant(TENANT, () =>
    db.transaction((tx) => tx.delete(auditExports).where(eq(auditExports.tenantId, TENANT))),
  ).catch(() => {});
  await rm(path.join(EXPORT_DIR, TENANT), { recursive: true, force: true }).catch(() => {});
  await app.close();
  await sqlClient.end();
});

// ───────────────────────────────────────────────────────────────────────────
// POST /audit/exports
// ───────────────────────────────────────────────────────────────────────────
describe("POST /audit/exports", () => {
  it("401 without a bearer token", async () => {
    const res = await app.inject({
      method: "POST", url: "/audit/exports",
      payload: { from: "2026-01-01T00:00:00.000Z", to: "2026-01-02T00:00:00.000Z", format: "json" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role outside EXPORT_ROLES", async () => {
    const jwt = token(["employee"], TENANT, randomUUID());
    const res = await app.inject({
      method: "POST", url: "/audit/exports",
      headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
      payload: { from: "2026-01-01T00:00:00.000Z", to: "2026-01-02T00:00:00.000Z", format: "json" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("202 accepted for audit_officer with a valid body", async () => {
    const jwt = token(["audit_officer"], TENANT, randomUUID());
    const res = await app.inject({
      method: "POST", url: "/audit/exports",
      headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
      payload: { from: "2026-01-01T00:00:00.000Z", to: "2026-01-02T00:00:00.000Z", format: "json" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().data ?? res.json()).toBeDefined();
  });

  it("400 for an invalid body (missing from/to)", async () => {
    const jwt = token(["audit_officer"], TENANT, randomUUID());
    const res = await app.inject({
      method: "POST", url: "/audit/exports",
      headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
      payload: { format: "json" },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// GET /v1/audit/exports/:id
// ───────────────────────────────────────────────────────────────────────────
describe("GET /v1/audit/exports/:id", () => {
  it("401 without a bearer token", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/audit/exports/${exportId}` });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role outside READER_ROLES", async () => {
    const jwt = token(["employee"], TENANT, ACTOR);
    const res = await app.inject({
      method: "GET", url: `/v1/audit/exports/${exportId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("404 for a random non-existent id", async () => {
    const jwt = token(["audit_officer"], TENANT, ACTOR);
    const res = await app.inject({
      method: "GET", url: `/v1/audit/exports/${randomUUID()}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("200 with the completed export's status DTO (requester sees the download token)", async () => {
    // sub === ACTOR === the export's createdBy, so canDownload() is true.
    const jwt = token(["audit_officer"], TENANT, ACTOR);
    const res = await app.inject({
      method: "GET", url: `/v1/audit/exports/${exportId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.status).toBe("completed");
    expect(data.ready).toBe(true);
    expect(typeof data.download).toBe("string");
    expect(data.download).toBe(signedUrl);
    expect(data.contentSha256).toBeTruthy();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// GET /v1/audit/exports/:id/download
// ───────────────────────────────────────────────────────────────────────────
describe("GET /v1/audit/exports/:id/download", () => {
  it("401 without a bearer token", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/audit/exports/${exportId}/download?token=${downloadToken}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role outside READER_ROLES", async () => {
    const jwt = token(["employee"], TENANT, ACTOR);
    const res = await app.inject({
      method: "GET", url: `/v1/audit/exports/${exportId}/download?token=${downloadToken}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("403 FORBIDDEN for a wrong download token", async () => {
    const jwt = token(["audit_officer"], TENANT, ACTOR);
    const res = await app.inject({
      method: "GET", url: `/v1/audit/exports/${exportId}/download?token=not-the-right-token`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  it("200 with the file content for the correct token", async () => {
    const jwt = token(["audit_officer"], TENANT, ACTOR);
    const res = await app.inject({
      method: "GET", url: `/v1/audit/exports/${exportId}/download?token=${downloadToken}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    const onDisk = await readFile(path.join(EXPORT_DIR, TENANT, `${exportId}.json`), "utf8");
    expect(res.payload).toBe(onDisk);
  });

  it("404 for a caller in a different tenant, even with an EXPORT_ROLES role and the correct token", async () => {
    const jwt = token(["audit_admin"], OTHER_TENANT, OTHER_ACTOR);
    const res = await app.inject({
      method: "GET", url: `/v1/audit/exports/${exportId}/download?token=${downloadToken}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// GET /v1/audit/exports/:id/verify
// ───────────────────────────────────────────────────────────────────────────
describe("GET /v1/audit/exports/:id/verify", () => {
  it("401 without a bearer token", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/audit/exports/${exportId}/verify` });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a role outside READER_ROLES", async () => {
    const jwt = token(["employee"], TENANT, ACTOR);
    const res = await app.inject({
      method: "GET", url: `/v1/audit/exports/${exportId}/verify`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("200 verified:true / contentMatch:true / signatureMatch:true for the untampered artifact", async () => {
    const jwt = token(["audit_officer"], TENANT, ACTOR);
    const res = await app.inject({
      method: "GET", url: `/v1/audit/exports/${exportId}/verify`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.verified).toBe(true);
    expect(data.contentMatch).toBe(true);
    expect(data.signatureMatch).toBe(true);
  });
});
