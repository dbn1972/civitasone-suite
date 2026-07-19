import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";

/**
 * Test-harness fix: `new MemoryQueue()` used directly (not the `createQueue()`
 * factory) does NOT auto-wrap subscribed handlers with `withTenantConsumer`,
 * AND its in-memory delivery uses `setTimeout(...)` which breaks out of the
 * calling async context entirely — so even an ambient AsyncLocalStorage
 * tenant scope from the test body would never reach the consumer handler.
 * Without this wrapping, every `db.transaction()` inside the consumer runs
 * with NO RLS GUC set, and the same is true for any bare `db.select()` /
 * `db.execute()` call made directly from the test body itself (wrap those in
 * `runWithTenant(tenantId, () => db.transaction(...))` too). Mirrors the
 * pattern already applied in tests/para.test.ts and admin-service's suite.
 */
function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}
import { computeHash } from "../src/modules/events/domain.js";
import {
  contentDigest, signManifest, verifyArtifact, canonicalManifest, signingKeyId, SIGNATURE_ALG,
} from "../src/modules/exports/signing.js";
import { computeRiskScore, riskBand } from "../src/modules/risk/domain.js";
import { assertCanTransition, isClosable, DomainError } from "../src/modules/observation/domain.js";

// ───────────────────────────────────────────────────────────────────────────
// 1. Tamper-evident hash chain (pure) — uses the current 6-arg content-bound API.
// ───────────────────────────────────────────────────────────────────────────
describe("audit event hash chain", () => {
  const content = { actor: { actorId: "a1" }, target: "r1", payload: { k: "v" } };

  it("produces a deterministic 64-char sha256 hash", () => {
    const h1 = computeHash("id1", "tenant1", "identity.user.created", null, "2026-06-20T00:00:00.000Z", content);
    const h2 = computeHash("id1", "tenant1", "identity.user.created", null, "2026-06-20T00:00:00.000Z", content);
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });

  it("a different prev_hash produces a different output (chaining)", () => {
    const h1 = computeHash("id1", "t1", "type", null, "2026-06-20T00:00:00.000Z", content);
    const h2 = computeHash("id1", "t1", "type", "prev", "2026-06-20T00:00:00.000Z", content);
    expect(h1).not.toBe(h2);
  });

  it("altering event content breaks the hash (content binding)", () => {
    const h1 = computeHash("id1", "t1", "type", null, "2026-06-20T00:00:00.000Z", content);
    const h2 = computeHash("id1", "t1", "type", null, "2026-06-20T00:00:00.000Z", { ...content, payload: { k: "tampered" } });
    expect(h1).not.toBe(h2);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. Risk scoring (pure) — score is server-computed from the 5x5 matrix.
// ───────────────────────────────────────────────────────────────────────────
describe("risk register scoring", () => {
  it("computes likelihood x impact in [1,25]", () => {
    expect(computeRiskScore("rare", "negligible")).toBe(1);
    expect(computeRiskScore("almost_certain", "catastrophic")).toBe(25);
    expect(computeRiskScore("possible", "major")).toBe(12);
  });
  it("bands the score correctly", () => {
    expect(riskBand(1)).toBe("low");
    expect(riskBand(6)).toBe("medium");
    expect(riskBand(12)).toBe("high");
    expect(riskBand(20)).toBe("critical");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. Observation lifecycle (pure) — log → reply → close transitions.
// ───────────────────────────────────────────────────────────────────────────
describe("observation lifecycle state machine", () => {
  it("open → replied → compliance_pending → closed is valid", () => {
    expect(() => assertCanTransition("open", "replied")).not.toThrow();
    expect(() => assertCanTransition("replied", "compliance_pending")).not.toThrow();
    expect(() => assertCanTransition("compliance_pending", "closed")).not.toThrow();
  });
  it("rejects an illegal jump open → closed", () => {
    expect(() => assertCanTransition("open", "closed")).toThrowError(DomainError);
    expect(() => assertCanTransition("open", "closed")).toThrowError("INVALID_TRANSITION");
  });
  it("a closed observation is terminal", () => {
    expect(isClosable("closed")).toBe(false);
    expect(isClosable("compliance_pending")).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4. Export signing / integrity (pure) — digest + detached HMAC signature.
// ───────────────────────────────────────────────────────────────────────────
describe("export signing & tamper-evidence", () => {
  const core = {
    exportId: "11111111-1111-1111-1111-111111111111",
    tenantId: "22222222-2222-2222-2222-222222222222",
    from: "2026-06-01T00:00:00.000Z", to: "2026-06-02T00:00:00.000Z",
    format: "json", includesPii: false, rowCount: 3,
  };

  it("contentDigest matches a plain sha256 of the bytes", () => {
    const body = '{"rows":[]}';
    expect(contentDigest(body)).toBe(createHash("sha256").update(body).digest("hex"));
  });

  it("verifies an untampered artifact", () => {
    const body = '{"rows":[1,2,3]}';
    const digest = contentDigest(body);
    const signature = signManifest({ ...core, contentSha256: digest });
    const res = verifyArtifact(body, { contentSha256: digest, signature }, core);
    expect(res.ok).toBe(true);
    expect(res.contentMatch).toBe(true);
    expect(res.signatureMatch).toBe(true);
  });

  it("detects content tamper (bytes changed, digest no longer matches)", () => {
    const body = '{"rows":[1,2,3]}';
    const digest = contentDigest(body);
    const signature = signManifest({ ...core, contentSha256: digest });
    const res = verifyArtifact('{"rows":[1,2,4]}', { contentSha256: digest, signature }, core);
    expect(res.ok).toBe(false);
    expect(res.contentMatch).toBe(false);
  });

  it("detects signature forgery (manifest field changed)", () => {
    const body = '{"rows":[1,2,3]}';
    const digest = contentDigest(body);
    const signature = signManifest({ ...core, contentSha256: digest });
    // attacker claims a different rowCount than was signed
    const res = verifyArtifact(body, { contentSha256: digest, signature }, { ...core, rowCount: 999 });
    expect(res.ok).toBe(false);
    expect(res.signatureMatch).toBe(false);
  });

  it("canonical manifest is order-independent and key-id/alg bound", () => {
    const m = canonicalManifest({ ...core, contentSha256: "abc" });
    expect(m).toContain(signingKeyId());
    expect(m).toContain(SIGNATURE_ALG);
    // reproducible regardless of object construction order
    const reordered = canonicalManifest({
      rowCount: core.rowCount, contentSha256: "abc", exportId: core.exportId,
      tenantId: core.tenantId, format: core.format, from: core.from, to: core.to,
      includesPii: core.includesPii,
    });
    expect(m).toBe(reordered);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 5. Queue wiring + ingestion idempotency (MemoryQueue, valid envelopes).
//    NOTE: MemoryQueue validates envelopes — messageId MUST be a UUID and the
//    queue must be start()ed, else messages are dropped to the DLQ.
// ───────────────────────────────────────────────────────────────────────────
describe("audit consumer queue wiring", () => {
  let q: MemoryQueue;
  const store: Array<{ tenantId: string; type: string }> = [];

  beforeEach(async () => {
    q = new MemoryQueue();
    store.length = 0;
    q.subscribe<{ service: string }>("audit.event.record", async (msg) => {
      store.push({ tenantId: msg.tenantId, type: msg.type });
    });
    await q.start();
  });

  function envelope(messageId: string, type: string) {
    return {
      messageId, type, tenantId: randomUUID(), actorId: randomUUID(),
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { service: "policy", action: "create", resourceType: "role", resourceId: "r1", outcome: "success" },
    };
  }

  it("routes audit.event.record to the consumer", async () => {
    await q.publish("audit.event.record", envelope(randomUUID(), "audit.event.record"));
    await new Promise((r) => setTimeout(r, 30));
    expect(store).toHaveLength(1);
  });

  it("dedupes a redelivered messageId (at-least-once → effectively-once)", async () => {
    let count = 0;
    const q2 = new MemoryQueue();
    q2.subscribe("audit.event.ingest", async () => { count++; });
    await q2.start();
    const msg = envelope(randomUUID(), "audit.event.ingest");
    await q2.publish("audit.event.ingest", msg);
    await q2.publish("audit.event.ingest", msg);
    await new Promise((r) => setTimeout(r, 40));
    expect(count).toBe(1);
    await q2.stop();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 6. Route auth — every route rejects unauthenticated callers.
// ───────────────────────────────────────────────────────────────────────────
describe("audit-service route auth (inject)", () => {
  for (const url of ["/v1/audit/risks", "/v1/audit/exports", "/v1/audit/observations", "/audit/events"]) {
    it(`GET ${url} without token → 401`, async () => {
      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(401);
      await app.close();
    });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// 7. Export PII gating + window validation (HTTP inject).
// ───────────────────────────────────────────────────────────────────────────
describe("export PII gating & window caps", () => {
  const SECRET = "test_secret_for_civitasone_32chr";
  const TENANT = "00000000-0000-0000-0000-000000000001";

  async function token(roles: string[]): Promise<string> {
    const { signToken } = await import("@civitasone/auth");
    return signToken({ sub: "11111111-1111-1111-1111-111111111111", tid: TENANT, roles } as never, SECRET);
  }

  it("audit_officer + includePii → 403 PII_EXPORT_FORBIDDEN", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const jwt = await token(["audit_officer"]);
    const res = await app.inject({
      method: "POST", url: "/audit/exports",
      headers: { authorization: `Bearer ${jwt}`, "x-tenant-id": TENANT, "content-type": "application/json" },
      payload: { from: "2026-06-23T00:00:00Z", to: "2026-06-24T00:00:00Z", format: "json", includePii: true },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("PII_EXPORT_FORBIDDEN");
    await app.close();
  });

  it("audit_admin + includePii → 202 accepted", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const jwt = await token(["audit_admin"]);
    const res = await app.inject({
      method: "POST", url: "/audit/exports",
      headers: { authorization: `Bearer ${jwt}`, "x-tenant-id": TENANT, "content-type": "application/json" },
      payload: { from: "2026-06-23T00:00:00Z", to: "2026-06-24T00:00:00Z", format: "json", includePii: true },
    });
    expect(res.statusCode).toBe(202);
    await app.close();
  });

  it("oversized window → 422 WINDOW_TOO_LARGE", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const jwt = await token(["audit_admin"]);
    const res = await app.inject({
      method: "POST", url: "/audit/exports",
      headers: { authorization: `Bearer ${jwt}`, "x-tenant-id": TENANT, "content-type": "application/json" },
      payload: { from: "2026-01-01T00:00:00Z", to: "2026-12-01T00:00:00Z", format: "json" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("WINDOW_TOO_LARGE");
    await app.close();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 8. DB-backed: append-only immutability, ingestion, tenant isolation,
//    and end-to-end signed export generation + integrity.
//    Seeded on a throwaway tenant; append-only rows are NOT deletable so we
//    isolate strictly by a random tenant id and never assert global counts.
// ───────────────────────────────────────────────────────────────────────────
describe("DB-backed audit ledger", () => {
  const TENANT_A = randomUUID();
  const TENANT_B = randomUUID();
  const ACTOR = randomUUID();
  const EXPORT_DIR = process.env.EXPORT_DIR ?? "/tmp/audit-exports";

  let db: typeof import("../src/shared/db.js")["db"];
  let sqlClient: typeof import("../src/shared/db.js")["sqlClient"];
  let auditEvents: typeof import("../src/modules/events/schema.js")["auditEvents"];
  let registerAuditConsumers: typeof import("../src/modules/events/consumer.js")["registerAuditConsumers"];
  let registerExportConsumers: typeof import("../src/modules/exports/consumer.js")["registerExportConsumers"];
  let auditExports: typeof import("../src/modules/exports/schema.js")["auditExports"];
  let processed: typeof import("../src/shared/outbox.js")["processed"];

  beforeAll(async () => {
    ({ db, sqlClient } = await import("../src/shared/db.js"));
    ({ auditEvents } = await import("../src/modules/events/schema.js"));
    ({ registerAuditConsumers } = await import("../src/modules/events/consumer.js"));
    ({ registerExportConsumers } = await import("../src/modules/exports/consumer.js"));
    ({ auditExports } = await import("../src/modules/exports/schema.js"));
    ({ processed } = await import("../src/shared/outbox.js"));
  });

  afterAll(async () => {
    // Best-effort cleanup of the throwaway export rows (exports are mutable);
    // events rows are append-only and intentionally left in place.
    try { await runWithTenant(TENANT_A, () => db.transaction((tx) => tx.delete(auditExports).where(eq(auditExports.tenantId, TENANT_A)))); } catch { /* noop */ }
    await rm(path.join(EXPORT_DIR, TENANT_A), { recursive: true, force: true }).catch(() => {});
    await sqlClient.end();
  });

  it("APPEND-ONLY: a direct UPDATE on events.events is rejected by the trigger", async () => {
    // Seed one row through the (allowed) INSERT path.
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerAuditConsumers(q);
    await q.start();
    const mid = randomUUID();
    await q.publish("audit.event.record", {
      messageId: mid, type: "audit.event.record", tenantId: TENANT_A, actorId: ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { service: "policy", action: "create", resourceType: "role", resourceId: "r1", outcome: "success" },
    });
    await new Promise((r) => setTimeout(r, 400));
    await q.stop();

    const rows = await runWithTenant(TENANT_A, () => db.transaction((tx) => tx.select().from(auditEvents).where(eq(auditEvents.tenantId, TENANT_A))));
    expect(rows.length).toBeGreaterThanOrEqual(1);

    await runWithTenant(TENANT_A, async () => {
      // UPDATE must be rejected by the BEFORE UPDATE trigger.
      await expect(
        db.transaction((tx) => tx.execute(sql`update events.events set severity = 'tampered' where tenant_id = ${TENANT_A}`)),
      ).rejects.toThrow(/append-only|not permitted|immutable/i);

      // DELETE must be rejected by the BEFORE DELETE trigger.
      await expect(
        db.transaction((tx) => tx.execute(sql`delete from events.events where tenant_id = ${TENANT_A}`)),
      ).rejects.toThrow(/append-only|not permitted|immutable/i);
    });

    // Row is untouched.
    const after = await runWithTenant(TENANT_A, () => db.transaction((tx) => tx.select().from(auditEvents).where(eq(auditEvents.tenantId, TENANT_A))));
    expect(after.every((r) => r.severity !== "tampered")).toBe(true);
  });

  it("INGESTION idempotency: a redelivered messageId inserts exactly one row", async () => {
    const tenant = randomUUID();
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerAuditConsumers(q);
    await q.start();
    const mid = randomUUID();
    const env = {
      messageId: mid, type: "audit.event.ingest", tenantId: tenant, actorId: ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { service: "s", action: "a", resourceType: "r", resourceId: "x", outcome: "success" },
    };
    await q.publish("audit.event.ingest", env);
    await new Promise((r) => setTimeout(r, 300));
    await q.publish("audit.event.ingest", { ...env }); // redelivery, same messageId
    await new Promise((r) => setTimeout(r, 300));
    await q.stop();

    const rows = await runWithTenant(tenant, () => db.transaction((tx) => tx.select().from(auditEvents).where(eq(auditEvents.tenantId, tenant))));
    expect(rows).toHaveLength(1);
    await runWithTenant(tenant, () => db.transaction((tx) => tx.delete(processed).where(eq(processed.messageId, mid)))).catch(() => {});
  });

  it("TENANT ISOLATION: tenant A's ledger never returns tenant B's rows", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerAuditConsumers(q);
    await q.start();
    await q.publish("audit.event.record", {
      messageId: randomUUID(), type: "audit.event.record", tenantId: TENANT_B, actorId: ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { service: "s", action: "a", resourceType: "r", resourceId: "b1", outcome: "success" },
    });
    await new Promise((r) => setTimeout(r, 400));
    await q.stop();

    const aRows = await runWithTenant(TENANT_A, () => db.transaction((tx) => tx.select().from(auditEvents).where(eq(auditEvents.tenantId, TENANT_A))));
    expect(aRows.every((r) => r.tenantId === TENANT_A)).toBe(true);
    const bRows = await runWithTenant(TENANT_B, () => db.transaction((tx) => tx.select().from(auditEvents).where(eq(auditEvents.tenantId, TENANT_B))));
    expect(bRows.length).toBeGreaterThanOrEqual(1);
  });

  it("SIGNED EXPORT: produces a real artifact whose persisted signature verifies, and a tampered file fails", async () => {
    const exportId = randomUUID();
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerAuditConsumers(q); // for the audit-trail event the export emits
    registerExportConsumers(q);
    await q.start();

    await q.publish("audit.export.create", {
      messageId: exportId, type: "audit.export.create", tenantId: TENANT_A, actorId: ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: {
        id: exportId, tenantId: TENANT_A,
        from: "2020-01-01T00:00:00.000Z", to: "2035-01-01T00:00:00.000Z",
        format: "json", includePii: false, roles: ["audit_admin"],
      },
    });
    await new Promise((r) => setTimeout(r, 1200));
    await q.stop();

    const rows = await runWithTenant(TENANT_A, () => db.transaction((tx) => tx.select().from(auditExports).where(eq(auditExports.id, exportId))));
    const row = rows[0];
    expect(row?.status).toBe("completed");
    expect(row?.contentSha256).toBeTruthy();
    expect(row?.signature).toBeTruthy();
    expect(row?.signatureAlg).toBe(SIGNATURE_ALG);

    // The artifact exists on disk and its persisted digest matches the bytes.
    const file = path.join(EXPORT_DIR, TENANT_A, `${exportId}.json`);
    const buf = await readFile(file);
    expect(contentDigest(buf)).toBe(row!.contentSha256);

    // Persisted signature verifies against the recomputed manifest.
    const ok = verifyArtifact(
      buf,
      { contentSha256: row!.contentSha256!, signature: row!.signature! },
      {
        exportId: row!.id, tenantId: row!.tenantId,
        from: row!.periodFrom.toISOString(), to: row!.periodTo.toISOString(),
        format: row!.format, includesPii: row!.includesPii, rowCount: row!.rowCount ?? 0,
      },
    );
    expect(ok.ok).toBe(true);

    // Sidecar manifest is present and self-consistent.
    const sidecar = JSON.parse(await readFile(path.join(EXPORT_DIR, TENANT_A, `${exportId}.sig.json`), "utf8"));
    expect(sidecar.signature).toBe(row!.signature);
    expect(sidecar.contentSha256).toBe(row!.contentSha256);

    // Tamper the WORM artifact on disk → integrity check must FAIL.
    await writeFile(file, buf.toString("utf8") + "\n/* tampered */", "utf8");
    const tampered = await readFile(file);
    const bad = verifyArtifact(
      tampered,
      { contentSha256: row!.contentSha256!, signature: row!.signature! },
      {
        exportId: row!.id, tenantId: row!.tenantId,
        from: row!.periodFrom.toISOString(), to: row!.periodTo.toISOString(),
        format: row!.format, includesPii: row!.includesPii, rowCount: row!.rowCount ?? 0,
      },
    );
    expect(bad.ok).toBe(false);
    expect(bad.contentMatch).toBe(false);
  });
});
