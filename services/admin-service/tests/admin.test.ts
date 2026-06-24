import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { db, sqlClient } from "../src/shared/db.js";
import { adminTenants } from "../src/modules/tenants/schema.js";
import { adminBreakGlassLog } from "../src/modules/support/schema.js";
import { adminApiKeys } from "../src/modules/api-keys/schema.js";
import { processed, outboxMessages } from "../src/shared/outbox.js";
import { registerTenantConsumers } from "../src/modules/tenants/consumer.js";
import { registerSupportConsumers, sweepExpiredBreakGlass } from "../src/modules/support/consumer.js";
import { resolveFeatureFlag } from "../src/modules/config/domain.js";
import { aggregateHealth } from "../src/modules/health/domain.js";
import { breakGlassExpiresAt, BREAK_GLASS_TTL_MS } from "../src/modules/support/domain.js";

const ACTOR = "00000000-aaaa-4000-8000-000000000001";
const T1_ID = "11111111-aaaa-4000-8000-000000000001";
const T2_ID = "22222222-aaaa-4000-8000-000000000002";
const MSG_1 = "aaaaaaaa-1111-4000-8000-000000000001";
const BG_ID = "bbbbbbbb-2222-4000-8000-000000000002";
const BG_EXP = "bbbbbbbb-2222-4000-8000-000000000099";
const TICKET = "cccccccc-3333-4000-8000-000000000003";

const SECRET = process.env.JWT_SECRET as string;
function token(roles: string[], tid: string): string {
  return signToken({ sub: ACTOR, roles, tid } as never, SECRET);
}
const bearer = (roles: string[], tid: string) => ({ authorization: `Bearer ${token(roles, tid)}` });

async function wipeTenant() {
  await db.delete(outboxMessages).where(eq(outboxMessages.tenantId, T1_ID));
  await db.delete(adminTenants).where(eq(adminTenants.id, T1_ID));
  await db.delete(processed).where(eq(processed.messageId, MSG_1));
}

describe("config domain — feature flag resolution (pure)", () => {
  it("tenant override wins over global=false", () => {
    expect(resolveFeatureFlag({ globalEnabled: false, tenantOverride: true })).toBe(true);
  });
});

describe("health domain — aggregate (pure)", () => {
  it("2 ok + 1 down → degraded", () => {
    const result = aggregateHealth([
      { service: "a", status: "ok" },
      { service: "b", status: "ok" },
      { service: "c", status: "down", httpStatus: 503 },
    ]);
    expect(result.status).toBe("degraded");
  });
});

describe("support domain — break-glass expiry (pure)", () => {
  it("opened_at + 2h = expires_at", () => {
    const opened = new Date("2025-01-01T10:00:00Z");
    const expires = breakGlassExpiresAt(opened);
    expect(expires.getTime() - opened.getTime()).toBe(BREAK_GLASS_TTL_MS);
  });
});

describe("tenant consumer — CQRS (integration)", () => {
  beforeAll(async () => { await wipeTenant(); });
  afterAll(async () => { await wipeTenant(); });

  it("admin.tenant.create writes admin_tenants + outbox", async () => {
    const q = new MemoryQueue();
    registerTenantConsumers(q);
    await q.start();
    await q.publish("admin.tenant.create", {
      messageId: MSG_1, type: "admin.tenant.create", tenantId: T1_ID,
      actorId: ACTOR, correlationId: "corr-admin-1", schemaVersion: "1.0",
      payload: {
        id: T1_ID, tenantId: T1_ID, name: "Admin Test", domain: "admin-test.example",
        edition: "psu", status: "draft", region: "ap-south-1", residency: "IN", settings: {}, version: 1,
      },
    });
    await new Promise((r) => setTimeout(r, 500));
    await q.stop();

    const rows = await db.select().from(adminTenants).where(eq(adminTenants.id, T1_ID));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.edition).toBe("psu");

    const outbox = await db.select().from(outboxMessages).where(eq(outboxMessages.tenantId, T1_ID));
    expect(outbox.map((r) => r.eventType)).toContain("admin.tenant.created");
    expect(outbox.map((r) => r.eventType)).toContain("audit.event.record");
  });
});

describe("admin-service route auth — unauthenticated (inject)", () => {
  it("GET /v1/admin/api-keys without token → 401", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/admin/api-keys" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("GET /v1/admin/breakglass without token → 401", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/admin/breakglass" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

// P1-1: authz-boundary wall. A tenant_admin token must be 403 on every PLATFORM
// mutation; cross-tenant reads must isolate; a super_admin happy-path per route.
describe("admin-service authz wall — tenant_admin → 403 on platform mutations (inject)", () => {
  const TENANT_ADMIN = bearer(["tenant_admin"], T1_ID);
  const someTenant = "33333333-aaaa-4000-8000-000000000033";
  const someUuid = "44444444-aaaa-4000-8000-000000000044";

  const cases: Array<{ name: string; method: "POST" | "PATCH"; url: string; payload?: unknown }> = [
    { name: "POST /tenants", method: "POST", url: "/v1/admin/tenants", payload: { name: "X", domain: "x.example", edition: "psu", region: "ap-south-1", residency: "IN" } },
    { name: "PATCH tenant edition", method: "PATCH", url: `/v1/admin/tenants/${someTenant}/edition`, payload: { edition: "enterprise" } },
    { name: "PATCH tenant suspend", method: "PATCH", url: `/v1/admin/tenants/${someTenant}/suspend`, payload: { reason: "policy violation here" } },
    { name: "PATCH tenant reactivate", method: "PATCH", url: `/v1/admin/tenants/${someTenant}/reactivate` },
    { name: "POST feature-flags create", method: "POST", url: "/v1/admin/feature-flags", payload: { flagKey: "beta_x", enabled: true } },
    { name: "PATCH feature-flag override", method: "PATCH", url: "/v1/admin/feature-flags/beta_x/override", payload: { tenantId: someTenant, enabled: true } },
    { name: "POST backup run", method: "POST", url: `/v1/admin/tenants/${someTenant}/backup/run` },
    { name: "POST backup schedule", method: "POST", url: `/v1/admin/tenants/${someTenant}/backup/schedule`, payload: { cronExpr: "0 2 * * *" } },
    { name: "POST break-glass open", method: "POST", url: "/v1/admin/support/break-glass", payload: { tenantId: someTenant, ticketId: someUuid, reason: "investigation needed now" } },
    { name: "PATCH break-glass close", method: "PATCH", url: `/v1/admin/support/break-glass/${someUuid}/close` },
  ];

  for (const c of cases) {
    it(`${c.name} → 403`, async () => {
      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();
      const res = await app.inject({ method: c.method, url: c.url, headers: TENANT_ADMIN, payload: c.payload });
      expect(res.statusCode).toBe(403);
      await app.close();
    });
  }
});

describe("admin-service authz wall — super_admin happy-path per route (inject)", () => {
  const SUPER = bearer(["super_admin"], T1_ID);
  const someTenant = "33333333-aaaa-4000-8000-000000000033";
  const someUuid = "44444444-aaaa-4000-8000-000000000044";

  // Accepted (202) for command routes; a super_admin must NOT be rejected at the
  // authz boundary. We assert "not 401/403" to keep it independent of downstream
  // DB state (e.g. a missing tenant surfaces later as 4xx/5xx, not an authz fail).
  const cases: Array<{ name: string; method: "GET" | "POST" | "PATCH"; url: string; payload?: unknown; expect?: number }> = [
    { name: "GET tenants", method: "GET", url: "/v1/admin/tenants", expect: 200 },
    { name: "GET api-keys", method: "GET", url: "/v1/admin/api-keys", expect: 200 },
    { name: "GET breakglass", method: "GET", url: "/v1/admin/breakglass", expect: 200 },
    { name: "GET feature-flags", method: "GET", url: "/v1/admin/feature-flags", expect: 200 },
    { name: "POST tenants", method: "POST", url: "/v1/admin/tenants", payload: { name: "Happy", domain: "happy.example", edition: "psu", region: "ap-south-1", residency: "IN" }, expect: 202 },
    { name: "POST break-glass open", method: "POST", url: "/v1/admin/support/break-glass", payload: { tenantId: someTenant, ticketId: someUuid, reason: "investigation needed now" }, expect: 202 },
  ];

  const createdTenantIds: string[] = [];

  for (const c of cases) {
    it(`${c.name} → authorized`, async () => {
      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();
      const res = await app.inject({ method: c.method, url: c.url, headers: SUPER, payload: c.payload });
      expect(res.statusCode).not.toBe(401);
      expect(res.statusCode).not.toBe(403);
      if (c.expect) expect(res.statusCode).toBe(c.expect);
      if (c.name === "POST tenants" && res.statusCode === 202) {
        createdTenantIds.push((JSON.parse(res.body) as { id: string }).id);
      }
      await app.close();
    });
  }

  afterAll(async () => {
    // clean up tenants / break-glass / outbox created by the happy-path POSTs
    await db.delete(outboxMessages).where(eq(outboxMessages.tenantId, someTenant));
    for (const id of createdTenantIds) {
      await db.delete(outboxMessages).where(eq(outboxMessages.tenantId, id));
      await db.delete(adminTenants).where(eq(adminTenants.id, id));
    }
  });
});

// P1-1: cross-tenant isolation on tenant-scoped reads (api-keys, config). A
// caller bound to T1 must never see T2's rows.
describe("admin-service cross-tenant isolation — api-keys read (inject)", () => {
  const K1 = "55555555-aaaa-4000-8000-000000000051";
  const K2 = "55555555-aaaa-4000-8000-000000000052";

  beforeAll(async () => {
    await db.delete(adminApiKeys).where(eq(adminApiKeys.id, K1));
    await db.delete(adminApiKeys).where(eq(adminApiKeys.id, K2));
    await db.insert(adminApiKeys).values([
      { id: K1, tenantId: T1_ID, keyName: "t1 key", keyPrefix: "civ_t1aaaa", keyHash: "h1", scopes: [], createdBy: ACTOR, updatedBy: ACTOR },
      { id: K2, tenantId: T2_ID, keyName: "t2 key", keyPrefix: "civ_t2aaaa", keyHash: "h2", scopes: [], createdBy: ACTOR, updatedBy: ACTOR },
    ]);
  });
  afterAll(async () => {
    await db.delete(adminApiKeys).where(eq(adminApiKeys.id, K1));
    await db.delete(adminApiKeys).where(eq(adminApiKeys.id, K2));
  });

  it("tenant_admin@T1 lists only T1 keys (never T2, never the hash)", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/admin/api-keys?limit=100", headers: bearer(["tenant_admin"], T1_ID) });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Array<{ id: string }>;
    const ids = body.map((r) => r.id);
    expect(ids).toContain(K1);
    expect(ids).not.toContain(K2);
    // hash must never be serialized
    expect(res.body).not.toContain("h1");
    expect(res.body).not.toContain("keyHash");
    await app.close();
  });

  it("tenant_admin@T2 lists only T2 keys", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/admin/api-keys?limit=100", headers: bearer(["tenant_admin"], T2_ID) });
    expect(res.statusCode).toBe(200);
    const ids = (JSON.parse(res.body) as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(K2);
    expect(ids).not.toContain(K1);
    await app.close();
  });
});

// P1-5: scope-escalation guard.
describe("admin-service api-keys — scope escalation rejected (inject)", () => {
  afterAll(async () => {
    await db.delete(adminApiKeys).where(eq(adminApiKeys.tenantId, T1_ID));
    await db.delete(outboxMessages).where(eq(outboxMessages.tenantId, T1_ID));
  });

  it("tenant_admin requesting a platform scope → 403", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/admin/api-keys", headers: bearer(["tenant_admin"], T1_ID),
      payload: { keyName: "escalate", scopes: ["platform:admin"] },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("create returns the raw key exactly once and list never returns it", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const created = await app.inject({
      method: "POST", url: "/v1/admin/api-keys", headers: bearer(["super_admin"], T1_ID),
      payload: { keyName: "good", scopes: ["config:read"] },
    });
    expect(created.statusCode).toBe(201);
    const body = JSON.parse(created.body) as { id: string; key: string };
    expect(body.key).toMatch(/^civ_/);

    const list = await app.inject({ method: "GET", url: "/v1/admin/api-keys?limit=100", headers: bearer(["super_admin"], T1_ID) });
    expect(list.body).not.toContain(body.key);
    await app.close();
  });
});

describe("break-glass consumer — audit emission (integration)", () => {
  beforeAll(async () => {
    await db.delete(adminBreakGlassLog).where(eq(adminBreakGlassLog.id, BG_ID));
    await db.delete(processed).where(eq(processed.messageId, BG_ID));
  });
  afterAll(async () => {
    await db.delete(outboxMessages).where(eq(outboxMessages.tenantId, T1_ID));
    await db.delete(adminBreakGlassLog).where(eq(adminBreakGlassLog.id, BG_ID));
  });

  it("open emits audit.event.record + opened (with expiresAt)", async () => {
    const q = new MemoryQueue();
    registerSupportConsumers(q);
    await q.start();
    await q.publish("admin.breakglass.open", {
      messageId: BG_ID, type: "admin.breakglass.open", tenantId: T1_ID,
      actorId: ACTOR, correlationId: "corr-bg-1", schemaVersion: "1.0",
      payload: { id: BG_ID, tenantId: T1_ID, ticketId: TICKET, reason: "SRE investigation required", actorId: ACTOR },
    });
    await new Promise((r) => setTimeout(r, 500));
    await q.stop();

    const rows = await db.select().from(adminBreakGlassLog).where(eq(adminBreakGlassLog.id, BG_ID));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ticketId).toBe(TICKET);

    const outbox = await db.select().from(outboxMessages).where(eq(outboxMessages.tenantId, T1_ID));
    expect(outbox.map((r) => r.eventType)).toContain("audit.event.record");
    const opened = outbox.find((r) => r.eventType === "admin.breakglass.opened");
    expect(opened).toBeDefined();
    expect((opened?.payload as { expiresAt?: string }).expiresAt).toBeDefined();
  });
});

// P1-2: TTL sweeper auto-closes an expired, still-open grant.
describe("break-glass TTL sweeper (integration)", () => {
  beforeAll(async () => {
    await db.delete(adminBreakGlassLog).where(eq(adminBreakGlassLog.id, BG_EXP));
    await db.delete(outboxMessages).where(eq(outboxMessages.tenantId, T2_ID));
    const opened = new Date(Date.now() - 3 * 60 * 60 * 1000); // 3h ago
    const expires = breakGlassExpiresAt(opened);                // -> 1h ago
    await db.insert(adminBreakGlassLog).values({
      id: BG_EXP, tenantId: T2_ID, ticketId: TICKET, actorId: ACTOR,
      reason: "expired grant for sweep test", openedAt: opened, expiresAt: expires,
      correlationId: "corr-bg-exp", createdBy: ACTOR, updatedBy: ACTOR,
    });
  });
  afterAll(async () => {
    await db.delete(adminBreakGlassLog).where(eq(adminBreakGlassLog.id, BG_EXP));
    await db.delete(outboxMessages).where(eq(outboxMessages.tenantId, T2_ID));
    await sqlClient.end();
  });

  it("sweep closes the expired grant and emits breakGlassClosed", async () => {
    const before = await db.select().from(adminBreakGlassLog).where(eq(adminBreakGlassLog.id, BG_EXP));
    expect(before[0]?.closedAt).toBeNull();

    const swept = await sweepExpiredBreakGlass(new Date());
    expect(swept).toBeGreaterThanOrEqual(1);

    const after = await db.select().from(adminBreakGlassLog).where(eq(adminBreakGlassLog.id, BG_EXP));
    expect(after[0]?.closedAt).not.toBeNull();

    const outbox = await db.select().from(outboxMessages).where(eq(outboxMessages.tenantId, T2_ID));
    expect(outbox.map((r) => r.eventType)).toContain("admin.breakglass.closed");

    // re-running the sweep is a no-op (grant already closed)
    const sweptAgain = await sweepExpiredBreakGlass(new Date());
    const stillThere = await db.select().from(adminBreakGlassLog).where(eq(adminBreakGlassLog.id, BG_EXP));
    expect(stillThere[0]?.closedAt).not.toBeNull();
    expect(sweptAgain).toBe(0);
  });
});
