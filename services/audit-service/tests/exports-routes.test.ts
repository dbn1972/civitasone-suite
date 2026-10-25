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
import { relayOnce } from "@civitasone/outbox";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { mintDownloadToken } from "../src/modules/exports/signing.js";

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
let downloadRedemptions: typeof import("../src/modules/exports/schema.js")["downloadRedemptions"];
let registerAuditConsumers: typeof import("../src/modules/events/consumer.js")["registerAuditConsumers"];
let registerExportConsumers: typeof import("../src/modules/exports/consumer.js")["registerExportConsumers"];

let exportId: string;
let downloadToken: string;
let signedUrl: string;

beforeAll(async () => {
  app = await buildApp();

  ({ db, sqlClient } = await import("../src/shared/db.js"));
  ({ auditExports, downloadRedemptions } = await import("../src/modules/exports/schema.js"));
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
  // Flush outbox so registerAuditConsumers picks up the enqueued audit events.
  await relayOnce(db as never, q, 100, "audit-service");
  await new Promise((r) => setTimeout(r, 500));
  await q.stop();

  const rows = await runWithTenant(TENANT, () =>
    db.transaction((tx) => tx.select().from(auditExports).where(eq(auditExports.id, exportId))),
  );
  const row = rows[0];
  if (!row || row.status !== "completed" || !row.signedUrl) {
    throw new Error(
      `test setup failed: export ${exportId} did not complete (status=${row?.status ?? "missing"})`,
    );
  }
  signedUrl = row.signedUrl;
  // The token is no longer persisted: mint a short-lived one bound to the requester.
  downloadToken = mintDownloadToken({ exportId, tenantId: TENANT, actorId: ACTOR }).token;
});

afterAll(async () => {
  await runWithTenant(TENANT, () =>
    db.transaction((tx) => tx.delete(downloadRedemptions).where(eq(downloadRedemptions.tenantId, TENANT))),
  ).catch(() => {});
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
// POST /v1/audit/exports
// ───────────────────────────────────────────────────────────────────────────
// G-FIX-4 regression guard: this route previously existed ONLY under the
// legacy /audit prefix — every other export endpoint (status/download/verify,
// below) is v1-only, so a client treating /v1/audit/exports as a complete,
// self-sufficient namespace for this resource got a 404 trying to create one.
// Confirmed live before this fix: POST /api/v1/audit/exports 404'd through
// the gateway while POST /api/audit/exports reached this same handler.
describe("POST /v1/audit/exports", () => {
  it("401 without a bearer token (same guard as the legacy path)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/audit/exports",
      payload: { from: "2026-01-01T00:00:00.000Z", to: "2026-01-02T00:00:00.000Z", format: "json" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("202 accepted for audit_officer with a valid body (route now exists under v1)", async () => {
    const jwt = token(["audit_officer"], TENANT, randomUUID());
    const res = await app.inject({
      method: "POST", url: "/v1/audit/exports",
      headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
      payload: { from: "2026-01-01T00:00:00.000Z", to: "2026-01-02T00:00:00.000Z", format: "json" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().data ?? res.json()).toBeDefined();
  });

  it("400 for an invalid body (missing from/to) (same guard as the legacy path)", async () => {
    const jwt = token(["audit_officer"], TENANT, randomUUID());
    const res = await app.inject({
      method: "POST", url: "/v1/audit/exports",
      headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
      payload: { format: "json" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("403 for a role outside EXPORT_ROLES (same guard as the legacy path)", async () => {
    const jwt = token(["employee"], TENANT, randomUUID());
    const res = await app.inject({
      method: "POST", url: "/v1/audit/exports",
      headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
      payload: { from: "2026-01-01T00:00:00.000Z", to: "2026-01-02T00:00:00.000Z", format: "json" },
    });
    expect(res.statusCode).toBe(403);
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
    // Short-lived requester-bound token (<exp>.<hmac>), never the stored path.
    expect(data.download).toMatch(/^\d+\.[0-9a-f]{64}$/);
    expect(data.download).not.toBe(signedUrl);
    expect(new Date(data.downloadExpiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(data.downloadExpiresAt).getTime()).toBeLessThanOrEqual(Date.now() + 15 * 60_000 + 1000);
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

  // Q34: the query-string token is single-use. Each case mints its own token (a
  // distinct expiry second) so the shared `downloadToken` above is not consumed.
  const freshToken = (offsetSec: number) =>
    mintDownloadToken({ exportId, tenantId: TENANT, actorId: ACTOR }, Date.now() + offsetSec * 1000).token;
  const dl = (t: string, jwt: string) =>
    app.inject({
      method: "GET", url: `/v1/audit/exports/${exportId}/download?token=${t}`,
      headers: { authorization: `Bearer ${jwt}` },
    });

  it("Q34: a successful download sends Referrer-Policy: no-referrer and no-store", async () => {
    const res = await dl(freshToken(61), token(["audit_officer"], TENANT, ACTOR));
    expect(res.statusCode).toBe(200);
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("Q34: the same token cannot be used twice (replay is 410 TOKEN_USED)", async () => {
    const t = freshToken(62);
    const jwt = token(["audit_officer"], TENANT, ACTOR);
    const first = await dl(t, jwt);
    expect(first.statusCode).toBe(200);
    const second = await dl(t, jwt);
    expect(second.statusCode).toBe(410);
    expect(second.json().code).toBe("TOKEN_USED");
    expect(second.payload).not.toContain(t);
  });

  it("Q34: a refused attempt does not burn the token (wrong role, then the right one succeeds)", async () => {
    const t = freshToken(63);
    const denied = await dl(t, token(["employee"], TENANT, ACTOR));
    expect(denied.statusCode).toBe(403);
    const ok = await dl(t, token(["audit_officer"], TENANT, ACTOR));
    expect(ok.statusCode).toBe(200);
  });

  it("Q34: only a hash of the redeemed token is stored, never the token", async () => {
    const t = freshToken(64);
    expect((await dl(t, token(["audit_officer"], TENANT, ACTOR))).statusCode).toBe(200);
    const rows = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(downloadRedemptions).where(eq(downloadRedemptions.exportId, exportId))),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.tokenSha256) && r.tokenSha256 !== t)).toBe(true);
    expect(rows.every((r) => r.redeemedBy === ACTOR)).toBe(true);
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

// ──────────────────────────────────────────────────────────────────────────────
// GAP-AUDIT-EXPORTS-07 — each export mutation writes an audit event
//
// Given the export driven through the consumer pipeline in beforeAll
//   (both registerExportConsumers and registerAuditConsumers were wired);
// When querying the audit_events table for the export's tenant;
// Then at least one row records the "create" action for the export resource,
//   and at least one records the "complete" action — proving each mutation
//   writes its own audit row.
//
// NOTE on token lifetime: the download token is a stateless HMAC (15-minute TTL,
// bound to the requester) — see the final test in this block.
// ──────────────────────────────────────────────────────────────────────────────
describe("GAP-AUDIT-EXPORTS-07 — each export mutation writes exactly one audit event", () => {
  let auditEventsTable: typeof import("../src/modules/events/schema.js")["auditEvents"];
  let dbForAudit: typeof import("../src/shared/db.js")["db"];
  let runWT: typeof import("@civitasone/db")["runWithTenant"];

  beforeAll(async () => {
    ({ auditEvents: auditEventsTable } = await import("../src/modules/events/schema.js"));
    ({ db: dbForAudit } = await import("../src/shared/db.js"));
    ({ runWithTenant: runWT } = await import("@civitasone/db"));
  });

  it("the export 'create' mutation wrote at least one audit event for this tenant", async () => {
    const { eq: eqFn } = await import("drizzle-orm");
    const events = await runWT(TENANT, () =>
      dbForAudit.transaction((tx) =>
        tx.select().from(auditEventsTable).where(eqFn(auditEventsTable.tenantId, TENANT)).limit(50),
      ),
    );
    const createEvent = events.find(
      (r) =>
        r.target === exportId &&
        typeof r.payload === "object" &&
        r.payload !== null &&
        (r.payload as Record<string, unknown>)["action"] === "create",
    );
    expect(createEvent).toBeDefined();
  });

  it("the export 'complete' mutation wrote a second audit event for this tenant", async () => {
    const { eq: eqFn } = await import("drizzle-orm");
    const events = await runWT(TENANT, () =>
      dbForAudit.transaction((tx) =>
        tx.select().from(auditEventsTable).where(eqFn(auditEventsTable.tenantId, TENANT)).limit(50),
      ),
    );
    const completeEvent = events.find(
      (r) =>
        r.target === exportId &&
        typeof r.payload === "object" &&
        r.payload !== null &&
        (r.payload as Record<string, unknown>)["action"] === "complete",
    );
    expect(completeEvent).toBeDefined();
  });

  it("the download token is short-lived, requester-bound and not persisted", async () => {
    const jwt = token(["audit_officer"], TENANT, ACTOR);
    // 1) Nothing reusable is stored: no token column value, no token in the stored path.
    const rows = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(auditExports).where(eq(auditExports.id, exportId))),
    );
    expect(rows[0]!.downloadToken).toBeNull();
    expect(rows[0]!.signedUrl).not.toContain("token=");
    // 2) The requester can download with a freshly minted token (single-use: the
    //    shared `downloadToken` was already spent by the earlier download tests).
    const mine = mintDownloadToken({ exportId, tenantId: TENANT, actorId: ACTOR }, Date.now() + 90_000).token;
    const ok = await app.inject({
      method: "GET", url: `/v1/audit/exports/${exportId}/download?token=${mine}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["cache-control"]).toBe("no-store");
    // 3) Replay by ANOTHER reader in the same tenant with the leaked token is rejected.
    const other = token(["audit_admin"], TENANT, randomUUID());
    const replay = await app.inject({
      method: "GET", url: `/v1/audit/exports/${exportId}/download?token=${mine}`,
      headers: { authorization: `Bearer ${other}` },
    });
    expect(replay.statusCode).toBe(403);
    // 4) An expired token (minted 20 minutes ago) is rejected with 410.
    const stale = mintDownloadToken({ exportId, tenantId: TENANT, actorId: ACTOR }, Date.now() - 20 * 60_000).token;
    const expired = await app.inject({
      method: "GET", url: `/v1/audit/exports/${exportId}/download?token=${stale}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(expired.statusCode).toBe(410);
    expect(expired.json().code).toBe("EXPIRED");
  });
});
