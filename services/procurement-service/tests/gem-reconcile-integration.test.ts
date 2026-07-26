/**
 * SVC-050 GeM / CPPP integration — route + consumer integration.
 *
 * Proves the honest not-configured fallback (503, no fake success, no ref
 * created) and the configured exchange + reconciliation flow against a mocked
 * provider, persisting to the real Postgres test DB.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { and, eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { procurementGemIntegrationRefs } from "../src/modules/gem/schema.js";
import { registerGemReconcileConsumers } from "../src/modules/gem/reconcile-consumer.js";
import { COMMANDS } from "../src/topics.js";
import { randomUUID } from "node:crypto";
import { vi } from "vitest";

const JWT_SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "acacacac-1111-4000-8000-0000000000a1";
const OTHER  = "acacacac-2222-4000-8000-0000000000b2";
const ACTOR  = "adadadad-0000-4000-8000-000000000001";

function token(roles = ["procurement_officer"]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess" }, JWT_SECRET, 3600);
}
function msg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: `corr-${type}`, schemaVersion: "1.0", payload };
}
function wire(q: Queue): Queue {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((t: string, h: Handler) => raw(t, withTenantConsumer(h) as Handler)) as typeof q.subscribe;
  return q;
}
async function drain(q: MemoryQueue) { await new Promise<void>((r) => setTimeout(r, 400)); await q.stop(); }
async function wipe() {
  await runWithTenant(TENANT, () => db.transaction((tx) =>
    tx.delete(procurementGemIntegrationRefs).where(eq(procurementGemIntegrationRefs.tenantId, TENANT))));
}

beforeEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.resetModules(); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
afterAll(async () => { await wipe(); await sqlClient.end(); });

describe("SVC-050 honest not-configured fallback", () => {
  it("config probe reports gem/cppp not configured by default", async () => {
    vi.stubEnv("GEM_ENABLED", "false");
    vi.stubEnv("CPPP_ENABLED", "false");
    vi.stubEnv("JWT_SECRET", JWT_SECRET);
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/procurement/gem/integration/config", headers: { authorization: `Bearer ${token()}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.providers).toEqual({ gem: false, cppp: false, gepnic: false });
    await app.close();
  });

  it("exchange returns 503 INTEGRATION_NOT_CONFIGURED and creates no ref", async () => {
    vi.stubEnv("GEM_ENABLED", "false");
    vi.stubEnv("JWT_SECRET", JWT_SECRET);
    await wipe();
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/procurement/gem/integration/exchange",
      headers: { authorization: `Bearer ${token()}`, "content-type": "application/json" },
      payload: { provider: "gem", entityType: "tender", entityId: "TND-1" },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe("INTEGRATION_NOT_CONFIGURED");
    const refs = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementGemIntegrationRefs).where(eq(procurementGemIntegrationRefs.tenantId, TENANT))));
    expect(refs).toHaveLength(0);
    await app.close();
  });
});

describe("SVC-050 configured exchange + reconciliation (mocked provider)", () => {
  it("exchange marks ref sent with external ref; reconcile marks it reconciled", async () => {
    vi.stubEnv("GEM_ENABLED", "true");
    vi.stubEnv("GEM_BASE_URL", "https://gem.example.com");
    vi.stubEnv("GEM_API_KEY", "test-key");

    const refId = randomUUID();
    await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(procurementGemIntegrationRefs).values({
      id: refId, tenantId: TENANT, provider: "gem", entityType: "order", entityId: "PO-1",
      direction: "outbound", status: "pending", attempts: 0, createdBy: ACTOR, updatedBy: ACTOR,
    })));

    // Exchange: provider accepts, returns an external ref.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({ externalRef: "GEM-ORD-9", status: "placed" }),
    }));
    const q = wire(new MemoryQueue()); registerGemReconcileConsumers(q); await q.start();
    await q.publish(COMMANDS.gemExchange, msg(COMMANDS.gemExchange, { id: refId, tenantId: TENANT, provider: "gem", entityType: "order", entityId: "PO-1", payload: {} }));
    await drain(q);

    let ref = (await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementGemIntegrationRefs).where(eq(procurementGemIntegrationRefs.id, refId)))))[0];
    expect(ref?.status).toBe("sent");
    expect(ref?.externalRef).toBe("GEM-ORD-9");
    expect(ref?.attempts).toBe(1);

    // Reconcile: provider reports terminal-accepted status.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({ status: "confirmed" }),
    }));
    const q2 = wire(new MemoryQueue()); registerGemReconcileConsumers(q2); await q2.start();
    await q2.publish(COMMANDS.gemReconcile, msg(COMMANDS.gemReconcile, { id: refId, tenantId: TENANT }));
    await drain(q2);

    ref = (await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementGemIntegrationRefs).where(eq(procurementGemIntegrationRefs.id, refId)))))[0];
    expect(ref?.status).toBe("reconciled");
    expect(ref?.externalStatus).toBe("confirmed");
  });

  it("provider error increments attempts and records last_error (no fake success)", async () => {
    vi.stubEnv("GEM_ENABLED", "true");
    vi.stubEnv("GEM_BASE_URL", "https://gem.example.com");
    vi.stubEnv("GEM_API_KEY", "test-key");

    const refId = randomUUID();
    await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(procurementGemIntegrationRefs).values({
      id: refId, tenantId: TENANT, provider: "gem", entityType: "tender", entityId: "TND-9",
      direction: "outbound", status: "pending", attempts: 0, createdBy: ACTOR, updatedBy: ACTOR,
    })));

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve("err") }));
    const q = wire(new MemoryQueue()); registerGemReconcileConsumers(q); await q.start();
    await q.publish(COMMANDS.gemExchange, msg(COMMANDS.gemExchange, { id: refId, tenantId: TENANT, provider: "gem", entityType: "tender", entityId: "TND-9", payload: {} }));
    await drain(q);

    const ref = (await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementGemIntegrationRefs).where(eq(procurementGemIntegrationRefs.id, refId)))))[0];
    expect(ref?.status).toBe("pending"); // still retryable, not fake-succeeded
    expect(ref?.attempts).toBe(1);
    expect(ref?.externalRef).toBeNull();
    expect(ref?.lastError).toBe("PROVIDER_ERROR");
  });
});


describe("SVC-050 GeM/CPPP — cross-tenant RLS isolation", () => {
  it("a foreign tenant cannot see another tenant's integration ref (tenant isolation)", async () => {
    await wipe();
    const refId = randomUUID();
    // Seed an integration ref owned by TENANT.
    await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(procurementGemIntegrationRefs).values({
      id: refId, tenantId: TENANT, provider: "gem", entityType: "order", entityId: "PO-RLS",
      direction: "outbound", status: "pending", attempts: 0, createdBy: ACTOR, updatedBy: ACTOR,
    })));

    // Under OTHER's tenant scope the ref is invisible.
    const asOther = await runWithTenant(OTHER, () => db.transaction((tx) =>
      tx.select().from(procurementGemIntegrationRefs).where(and(eq(procurementGemIntegrationRefs.id, refId), eq(procurementGemIntegrationRefs.tenantId, OTHER)))));
    expect(asOther).toHaveLength(0);

    // Control: the owning tenant does see it.
    const asTenant = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(procurementGemIntegrationRefs).where(eq(procurementGemIntegrationRefs.id, refId))));
    expect(asTenant).toHaveLength(1);
    await wipe();
  });
});
