/**
 * h4-admin-platform-tenancy batch -- audit trail on destructive platform actions.
 *
 *  - GAP-ADMIN-FEATURE-FLAGS-01: the feature-flag kill consumer records the
 *    operator's reason (and actor) in the audit.event.record outbox row.
 *  - GAP-ADMIN-GATEWAY-CONFIG-02: PATCH /v1/admin/platform-config/gateway
 *    requires a reason, rejects out-of-bounds values, and emits an audit row
 *    with actor + reason + per-field before/after.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { eq, and } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { signToken } from "@civitasone/auth";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { featureFlags } from "../src/modules/feature-flags/schema.js";
import { registerFeatureFlagConsumers } from "../src/modules/feature-flags/consumer.js";
import { COMMANDS } from "../src/topics.js";

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const ACTOR = "a4000000-0000-4000-8000-0000000000a1";
const T1 = "a4111111-1111-4000-8000-000000000001";
const FLAG_ID = "a4222222-2222-4000-8000-000000000001";
const MSG_CREATE = "a4333333-3333-4000-8000-000000000001";
const MSG_KILL = "a4333333-3333-4000-8000-000000000002";

const bearer = (roles: string[]) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, roles, tid: T1 } as never, SECRET)}`,
});

async function auditRows(): Promise<Array<{ actorId: string; payload: Record<string, unknown> }>> {
  const rows = await runWithTenant(T1, () =>
    db.transaction((tx) =>
      tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, T1), eq(outboxMessages.eventType, "audit.event.record"))),
    ),
  );
  return rows.map((r) => ({ actorId: r.actorId, payload: r.payload as Record<string, unknown> }));
}

async function cleanup() {
  await runWithTenant(T1, () => db.transaction(async (tx) => {
    await tx.delete(featureFlags).where(eq(featureFlags.tenantId, T1));
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, T1));
    await tx.delete(processed).where(eq(processed.messageId, MSG_CREATE));
    await tx.delete(processed).where(eq(processed.messageId, MSG_KILL));
  }));
}

beforeAll(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("feature-flag kill consumer -- reason in audit (GAP-ADMIN-FEATURE-FLAGS-01)", () => {
  it("kills the flag and writes an audit record carrying actor + reason", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerFeatureFlagConsumers(q);
    await q.start();
    const base = { tenantId: T1, actorId: ACTOR, schemaVersion: "1.0", timestamp: new Date().toISOString() };
    await q.publish(COMMANDS.featureFlagManageCreate, {
      ...base, messageId: MSG_CREATE, type: COMMANDS.featureFlagManageCreate, correlationId: "corr-ff-c",
      payload: { id: FLAG_ID, tenantId: T1, key: "h4_kill_reason", name: "Kill reason", description: "", enabled: true, rolloutPercent: 100, targetSegments: [] }, // gitleaks:allow -- feature-flag key fixture, not a secret
    });
    await new Promise((r) => setTimeout(r, 400));
    await q.publish("admin.feature_flag.kill", {
      ...base, messageId: MSG_KILL, type: "admin.feature_flag.kill", correlationId: "corr-ff-k",
      payload: { flagId: FLAG_ID, tenantId: T1, reason: "INC-77 payment outage" },
    });
    await new Promise((r) => setTimeout(r, 500));
    await q.stop();

    const flags = await runWithTenant(T1, () => db.transaction((tx) => tx.select().from(featureFlags).where(eq(featureFlags.id, FLAG_ID))));
    expect(flags[0]?.killSwitch).toBe(true);
    const kill = (await auditRows()).find((r) => r.payload.action === "kill");
    expect(kill).toBeDefined();
    expect(kill?.payload.reason).toBe("INC-77 payment outage");
    expect(kill?.payload.resourceId).toBe(FLAG_ID);
    expect(kill?.actorId).toBe(ACTOR);
  });
});

describe("PATCH /v1/admin/platform-config/gateway -- reason + audit (GAP-ADMIN-GATEWAY-CONFIG-02)", () => {
  const realFetch = globalThis.fetch;
  const gatewayState: Record<string, unknown> = { jwtEdgeVerify: "true", rateLimitMax: 1000 };

  function stubGateway() {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        Object.assign(gatewayState, JSON.parse(String(init.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({ status: "updated", data: gatewayState }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ data: { ...gatewayState } }), { status: 200, headers: { "content-type": "application/json" } });
    });
  }
  afterEach(() => { vi.restoreAllMocks(); globalThis.fetch = realFetch; });

  it("403 for a tenant_admin", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({ method: "PATCH", url: "/v1/admin/platform-config/gateway", headers: bearer(["tenant_admin"]), payload: { jwtEdgeVerify: "off", reason: "test" } });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("400 without a reason, and 400 for an out-of-bounds rate limit", async () => {
    stubGateway();
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const noReason = await app.inject({ method: "PATCH", url: "/v1/admin/platform-config/gateway", headers: bearer(["platform_admin"]), payload: { jwtEdgeVerify: "off" } });
    const tooHigh = await app.inject({ method: "PATCH", url: "/v1/admin/platform-config/gateway", headers: bearer(["platform_admin"]), payload: { rateLimitMax: 10_000_000, reason: "load test" } });
    const reasonOnly = await app.inject({ method: "PATCH", url: "/v1/admin/platform-config/gateway", headers: bearer(["platform_admin"]), payload: { reason: "nothing to change" } });
    await app.close();
    expect(noReason.statusCode).toBe(400);
    expect(tooHigh.statusCode).toBe(400);
    expect(reasonOnly.statusCode).toBe(400);
  });

  it("applies the change, never forwards the reason to the gateway, and audits actor + reason + before/after", async () => {
    stubGateway();
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH", url: "/v1/admin/platform-config/gateway", headers: bearer(["super_admin"]),
      payload: { jwtEdgeVerify: "audit", reason: "Keycloak key rotation window" },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const patchCall = vi.mocked(globalThis.fetch).mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PATCH");
    expect(JSON.parse(String((patchCall?.[1] as RequestInit).body))).toEqual({ jwtEdgeVerify: "audit" });

    const row = (await auditRows()).find((r) => r.payload.action === "gateway_config.update");
    expect(row).toBeDefined();
    expect(row?.actorId).toBe(ACTOR);
    expect(row?.payload.reason).toBe("Keycloak key rotation window");
    expect(row?.payload.changes).toEqual({ jwtEdgeVerify: { from: "true", to: "audit" } });
  });
});
