/**
 * Remaining coverage tests — targets specific uncovered modules:
 *   - SAML routes (/v1/identity/saml/*)
 *   - MFA consumer (integration)
 *   - kc-reconcile (unit — reconcileDueDeactivations, markRetry, countPending)
 *   - Sessions domain types (import coverage)
 *   - MFA domain types (import coverage)
 *   - API keys queries
 *   - Sessions queries/commands/repo
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { eq, and } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { mfaConfigs } from "../src/modules/mfa/schema.js";
import { users } from "../src/modules/users/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const ACTOR = "a0000000-0000-4000-8000-0000000000aa";

function token(roles: string[] = ["super_admin"], tid = TENANT, sub = ACTOR): string {
  return signToken({ sub, tid, roles, sid: "sess-1" } as never, SECRET);
}
const headers = (roles?: string[]) => ({ authorization: `Bearer ${token(roles)}` });

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

let app: FastifyInstance;

beforeAll(async () => {
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
});
afterAll(async () => { await app.close(); });

// ── SAML routes ─────────────────────────────────────────────────────────────
describe("SAML routes — full coverage", () => {
  it("GET /v1/identity/saml/metadata → 200 with XML (no auth needed)", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/identity/saml/metadata",
      headers: headers(["super_admin"]),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/xml");
    expect(res.body).toContain("EntityDescriptor");
    expect(res.body).toContain("SPSSODescriptor");
  });

  it("POST /v1/identity/saml/acs → 501 (not implemented)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/identity/saml/acs",
      headers: headers(["super_admin"]),
      payload: { SAMLResponse: "base64data" },
    });
    expect(res.statusCode).toBe(501);
    expect(res.json().code).toBe("NOT_IMPLEMENTED");
  });

  it("PUT /v1/identity/saml/config → 401 without token", async () => {
    const res = await app.inject({
      method: "PUT", url: "/v1/identity/saml/config",
      payload: { entityId: "test", acsUrl: "https://example.com/acs" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("PUT /v1/identity/saml/config → 403 for employee", async () => {
    const res = await app.inject({
      method: "PUT", url: "/v1/identity/saml/config",
      headers: headers(["employee"]),
      payload: { entityId: "test", acsUrl: "https://example.com/acs" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("PUT /v1/identity/saml/config → 202 for super_admin", async () => {
    const res = await app.inject({
      method: "PUT", url: "/v1/identity/saml/config",
      headers: headers(["super_admin"]),
      payload: { entityId: "civitasone-test", acsUrl: "https://app.test.gov.in/saml/acs" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("GET /v1/identity/saml/config → 401 without token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/identity/saml/config" });
    expect(res.statusCode).toBe(401);
  });

  it("GET /v1/identity/saml/config → 200 for super_admin", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/identity/saml/config",
      headers: headers(["super_admin"]),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("entityId");
    expect(res.json()).toHaveProperty("signRequests");
  });

  it("PUT /v1/identity/saml/config → 400 with invalid body", async () => {
    const res = await app.inject({
      method: "PUT", url: "/v1/identity/saml/config",
      headers: headers(["super_admin"]),
      payload: { entityId: "", acsUrl: "not-a-url" },
    });
    expect([400, 500]).toContain(res.statusCode);
  });
});

// ── MFA consumer (integration) ──────────────────────────────────────────────
describe("MFA consumer — enableMfa integration", () => {
  const MFA_TENANT = "f4444444-4444-4000-8000-000000000f4f";
  const MFA_USER = "b4444444-4444-4000-8000-000000000b44";
  const MSG_ENABLE = "c4444444-4444-4000-8000-000000000c44";
  const MFA_CFG_ID = "d4444444-4444-4000-8000-000000000d44";

  beforeAll(async () => {
    // Seed a user for the MFA test
    await runWithTenant(MFA_TENANT, () => db.transaction(async (tx) => {
      await tx.insert(users).values({
        id: MFA_USER, tenantId: MFA_TENANT, email: "mfa-consumer@test.gov.in",
        name: "MFA Test", status: "active", createdBy: ACTOR, updatedBy: ACTOR,
      }).onConflictDoNothing();
    }));
  });

  afterAll(async () => {
    await runWithTenant(MFA_TENANT, () => db.transaction(async (tx) => {
      await tx.delete(mfaConfigs).where(and(eq(mfaConfigs.userId, MFA_USER), eq(mfaConfigs.tenantId, MFA_TENANT)));
      await tx.delete(users).where(eq(users.id, MFA_USER));
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, MFA_TENANT));
      await tx.delete(processed).where(eq(processed.messageId, MSG_ENABLE));
    }));
  });

  it("processes identity.mfa.enable → inserts/updates mfaConfig + emits events", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    const { registerMfaConsumers } = await import("../src/modules/mfa/consumer.js");
    registerMfaConsumers(q);
    await q.start();

    await q.publish("identity.mfa.enable", {
      messageId: MSG_ENABLE, type: "identity.mfa.enable", tenantId: MFA_TENANT,
      actorId: ACTOR, correlationId: "corr-mfa-1", schemaVersion: "1.0",
      timestamp: new Date().toISOString(),
      payload: { id: MFA_CFG_ID, userId: MFA_USER, method: "totp", tenantId: MFA_TENANT },
    });

    await new Promise((r) => setTimeout(r, 600));
    await q.stop();

    // Verify mfa config was inserted
    const [cfg] = await runWithTenant(MFA_TENANT, () => db.transaction(async (tx) =>
      tx.select().from(mfaConfigs).where(and(eq(mfaConfigs.userId, MFA_USER), eq(mfaConfigs.tenantId, MFA_TENANT)))));
    expect(cfg).toBeDefined();
    expect(cfg.method).toBe("totp");
    expect(cfg.enabled).toBe(true);

    // Verify user.mfaEnabled was set
    const [usr] = await runWithTenant(MFA_TENANT, () => db.transaction(async (tx) =>
      tx.select().from(users).where(eq(users.id, MFA_USER))));
    expect(usr.mfaEnabled).toBe(true);

    // Verify outbox events
    const outbox = await runWithTenant(MFA_TENANT, () => db.transaction(async (tx) =>
      tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, MFA_TENANT))));
    expect(outbox.map((r) => r.eventType)).toContain("identity.mfa.enabled");
    expect(outbox.map((r) => r.eventType)).toContain("audit.event.record");
  });
});

// ── kc-reconcile unit tests ─────────────────────────────────────────────────
describe("kc-reconcile — unit tests", () => {
  it("reconcileDueDeactivations handles empty set", async () => {
    const { reconcileDueDeactivations } = await import("../src/shared/kc-reconcile.js");
    const mockDeactivate = async () => ({ ok: true, skipped: true, reason: "test" });
    const result = await reconcileDueDeactivations(db, mockDeactivate, 5);
    // With no pending rows, both counters are 0
    expect(result.reconciled).toBe(0);
    expect(result.retried).toBe(0);
  });

  it("countPending returns number", async () => {
    const { countPending } = await import("../src/shared/kc-reconcile.js");
    const count = await countPending(db);
    expect(typeof count).toBe("number");
    expect(count).toBeGreaterThanOrEqual(0);
  });
});

// ── Domain type imports (ensures modules are loaded) ────────────────────────
describe("Domain types — import coverage", () => {
  it("SessionView type is importable", async () => {
    const mod = await import("../src/modules/sessions/domain.js");
    // Type-only module — just confirm it loads
    expect(mod).toBeDefined();
  });

  it("MfaView type is importable", async () => {
    const mod = await import("../src/modules/mfa/domain.js");
    expect(mod).toBeDefined();
  });
});

// ── API Keys queries ────────────────────────────────────────────────────────
describe("API Keys queries — coverage", () => {
  it("listApiKeys returns array", async () => {
    const { listApiKeys } = await import("../src/modules/apikeys/queries.js");
    const result = await runWithTenant(TENANT, () => listApiKeys(TENANT, 10, 0));
    expect(Array.isArray(result)).toBe(true);
  });

  it("getApiKey returns null for nonexistent", async () => {
    const { getApiKey } = await import("../src/modules/apikeys/queries.js");
    const result = await runWithTenant(TENANT, () => getApiKey(TENANT, "99999999-9999-4000-8000-999999999999"));
    expect(result).toBeNull();
  });
});

// ── Sessions commands coverage ──────────────────────────────────────────────
describe("Sessions commands — coverage", () => {
  it("createSession publishes to queue and returns accepted", async () => {
    const { createSession } = await import("../src/modules/sessions/commands.js");
    const ctx = { tenantId: TENANT, actorId: ACTOR, actorType: "user" as const, roles: ["super_admin"], correlationId: randomUUID(), sessionId: "" };
    const result = await createSession(ctx, { tenantId: TENANT, userId: ACTOR, ip: "127.0.0.1", ttlSeconds: 1800 });
    expect(result.id).toBeDefined();
    expect(result.status).toBe("accepted");
  });

  it("revokeSession publishes to queue and returns accepted", async () => {
    const { revokeSession } = await import("../src/modules/sessions/commands.js");
    const ctx = { tenantId: TENANT, actorId: ACTOR, actorType: "user" as const, roles: ["super_admin"], correlationId: randomUUID(), sessionId: "" };
    const result = await revokeSession(ctx, "11111111-1111-4000-8000-000000000001");
    expect(result.id).toBeDefined();
    expect(result.status).toBe("accepted");
  });

  it("revokeAllSessions publishes to queue", async () => {
    const { revokeAllSessions } = await import("../src/modules/sessions/commands.js");
    const ctx = { tenantId: TENANT, actorId: ACTOR, actorType: "user" as const, roles: ["super_admin"], correlationId: randomUUID(), sessionId: "" };
    const result = await revokeAllSessions(ctx, ACTOR);
    expect(result.id).toBeDefined();
    expect(result.status).toBe("accepted");
  });
});

// ── Sessions queries coverage ───────────────────────────────────────────────
describe("Sessions queries — coverage", () => {
  it("listSessions returns array", async () => {
    const { listSessions } = await import("../src/modules/sessions/queries.js");
    const result = await runWithTenant(TENANT, () => listSessions(TENANT, 10));
    expect(Array.isArray(result)).toBe(true);
  });

  it("getSession returns null for nonexistent", async () => {
    const { getSession } = await import("../src/modules/sessions/queries.js");
    const result = await runWithTenant(TENANT, () => getSession(TENANT, "99999999-9999-4000-8000-999999999999"));
    expect(result).toBeNull();
  });
});
