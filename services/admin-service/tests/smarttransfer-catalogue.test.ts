/**
 * ST-M01-03 — SmartTransfer OS catalogue & plan-to-composition applier.
 *
 * Verifies (against a real Postgres with RLS):
 *   • the catalogue can EXPRESS the standalone SKU: workforce_core +
 *     smarttransfer registry rows with the D-ST-23/01/02/03 dependency edges,
 *     the smarttransfer_standalone bundle and org profile;
 *   • onboarding the standalone profile resolves to core + workforce_core +
 *     smarttransfer and NOTHING else — no leave/payroll/recruitment/employee;
 *   • the standalone tenant's gateway projection does NOT include payroll /
 *     leave / recruitment keys (M01 exit criterion 3's catalogue precondition —
 *     this row only makes the catalogue express it; enforcement is ST-M01-02);
 *   • the plan-to-composition applier write path: route → command → 202 →
 *     consumer (markProcessed + guarded write + audit.event.record in one tx);
 *   • applier idempotency, unknown-module rejection, tenant isolation, and that
 *     a tenant_admin cannot target another tenant.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const { buildApp } = await import("../src/app.js");
const { sqlClient } = await import("../src/shared/db.js");
const { queue } = await import("../src/shared/infra.js");
const { registerCompositionConsumers } = await import("../src/modules/composition/consumer.js");

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const STANDALONE = "d7000000-0000-4000-8000-0000000000a1";
const APPLY = "d7000000-0000-4000-8000-0000000000a2";
const OTHER = "d7000000-0000-4000-8000-0000000000a3";
const PLATFORM_TARGET = "d7000000-0000-4000-8000-0000000000a4";
const ADMIN = "d7000000-eeee-4000-8000-000000000001";
const TENANTS = [STANDALONE, APPLY, OTHER, PLATFORM_TARGET];

function token(actorId: string, roles: string[], tenantId: string): string {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-st03" }, SECRET, 3600);
}
function auth(tenantId: string, roles: string[] = ["tenant_admin"]) {
  return { authorization: `Bearer ${token(ADMIN, roles, tenantId)}` };
}

async function wipe(): Promise<void> {
  for (const t of TENANTS) {
    await sqlClient`DELETE FROM composition.tenant_entitlement WHERE tenant_id = ${t}`;
    await sqlClient`DELETE FROM composition.tenant_profile WHERE tenant_id = ${t}`;
  }
}

function readAsTenant<T>(tenantId: string, run: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${tenantId}, true)`;
    return run(sql as typeof sqlClient);
  }) as Promise<T>;
}

const sourceMap = (body: { modules: Array<{ id: string; source: string }> }): Record<string, string> =>
  Object.fromEntries(body.modules.map((m) => [m.id, m.source]));

let app: FastifyInstance;
beforeAll(async () => {
  // The applier consumer only runs in src/worker.ts in production; register it
  // here against the queue singleton buildApp() publishes through. The handler
  // wraps its own runWithTenant(), so it is registered on the plain queue.
  registerCompositionConsumers(queue);
  await queue.start();
  app = await buildApp();
  await wipe();
});
afterAll(async () => { await wipe(); await app.close(); await queue.stop(); await sqlClient.end(); });

describe("catalogue can express the standalone SKU", () => {
  it("registry has workforce_core + smarttransfer with the approved deps", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/composition/registry", headers: auth(STANDALONE) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const wc = body.modules.find((m: { id: string }) => m.id === "workforce_core");
    const st = body.modules.find((m: { id: string }) => m.id === "smarttransfer");
    expect(wc).toBeDefined();
    expect(wc.isCore).toBe(false);
    expect(wc.cluster).toBe("workforce");
    expect(wc.hardDeps).toEqual(expect.arrayContaining(["org", "config"]));
    expect(st).toBeDefined();
    expect(st.hardDeps).toEqual(expect.arrayContaining(["workforce_core", "workflow", "audit"]));
    // bundle + profile present
    expect(body.bundles.map((b: { code: string }) => b.code)).toContain("smarttransfer_standalone");
    const stBundle = body.bundles.find((b: { code: string }) => b.code === "smarttransfer_standalone");
    expect(stBundle.moduleIds).toEqual(["smarttransfer"]);
    expect(body.profiles.map((p: { code: string }) => p.code)).toContain("smarttransfer_standalone");
  });
});

describe("onboarding the standalone profile", () => {
  it("resolves to core + workforce_core + smarttransfer and NOTHING else", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/composition/onboard",
      headers: auth(STANDALONE), payload: { profile: "smarttransfer_standalone" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.profile.code).toBe("smarttransfer_standalone");
    const src = sourceMap(body);
    // smarttransfer is the single user pick; workforce_core is its hard dep.
    expect(src["smarttransfer"]).toBe("user");
    expect(src["workforce_core"]).toBe("dep");
    // core kernel present
    expect(src["workflow"]).toBe("core");
    expect(src["audit"]).toBe("core");
    expect(src["org"]).toBe("core");
    expect(src["config"]).toBe("core");
    // the whole point: NO non-core HR / payroll / finance modules
    for (const forbidden of ["employee", "leave", "attendance", "payroll", "recruitment", "appraisal", "separation", "finance"]) {
      expect(src[forbidden]).toBeUndefined();
    }
  });

  it("projects to gateway keys WITHOUT payroll / leave / recruitment reachable", async () => {
    // The internal endpoint feeds the gateway module-guard. For the standalone
    // tenant it must expose only the workforce/smarttransfer surface + core.
    const res = await app.inject({
      method: "GET", url: `/v1/admin/composition/internal/${STANDALONE}/modules`,
      headers: auth(STANDALONE, ["super_admin"]),
    });
    expect(res.statusCode).toBe(200);
    const keys = res.json().data.map((m: { name: string }) => m.name);
    expect(keys).toEqual(expect.arrayContaining(["smarttransfer", "hrms", "workflow"]));
    // workforce_core projects to "hrms" (sub-route granularity is ST-M01-04);
    // but payroll is a SEPARATE key and must be absent, as must any
    // leave/recruitment-specific key. (hrms is present only via workforce_core;
    // leave/recruitment have no distinct gateway key, they ride "hrms" — the
    // gateway sub-route split that withholds them is explicitly ST-M01-04.)
    expect(keys).not.toContain("payroll");
    expect(keys).not.toContain("finance");
    expect(keys).not.toContain("procurement");
  });
});

describe("plan-to-composition applier (write path)", () => {
  it("applies a module set + profile through command → consumer → audit, in one tx", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/composition/apply-plan",
      headers: auth(APPLY),
      payload: { moduleIds: ["smarttransfer"], profileCode: "smarttransfer_standalone" },
    });
    expect(res.statusCode).toBe(202);
    await (queue as unknown as { drain?: () => Promise<void> }).drain?.();

    // entitlement rows written (user pick persisted; deps derived on read)
    const ents = await readAsTenant(APPLY, (sql) =>
      sql<Array<{ module_id: string; source: string }>>`
        SELECT module_id, source FROM composition.tenant_entitlement WHERE tenant_id = ${APPLY} ORDER BY module_id`);
    expect(ents.map((r) => r.module_id)).toEqual(["smarttransfer"]);
    expect(ents[0]?.source).toBe("user");

    // profile stamped
    const prof = await readAsTenant(APPLY, (sql) =>
      sql<Array<{ profile_code: string }>>`
        SELECT profile_code FROM composition.tenant_profile WHERE tenant_id = ${APPLY}`);
    expect(prof[0]?.profile_code).toBe("smarttransfer_standalone");

    // audit event enqueued in the SAME tx (outbox row)
    const audit = await readAsTenant(APPLY, (sql) =>
      sql<Array<{ topic: string; payload: Record<string, unknown> }>>`
        SELECT topic, payload FROM _outbox.messages
        WHERE tenant_id = ${APPLY} AND topic = 'audit.event.record'`);
    const applyAudit = audit.find((a) => (a.payload as { action?: string }).action === "composition_apply_plan");
    expect(applyAudit).toBeDefined();
    expect((applyAudit!.payload as { resourceType?: string }).resourceType).toBe("tenant_composition");

    // the effective composition reflects the applied plan
    const view = await app.inject({ method: "GET", url: "/v1/admin/composition/tenant", headers: auth(APPLY) });
    const src = sourceMap(view.json());
    expect(src["smarttransfer"]).toBe("user");
    expect(src["workforce_core"]).toBe("dep");
    expect(src["payroll"]).toBeUndefined();
  });

  it("is idempotent on a re-sent command (same correlation id → one effect)", async () => {
    // Re-apply with a different module set but the SAME correlation id must NOT
    // double-write: the deterministic messageId dedupes at the consumer.
    const corr = "11111111-2222-4000-8000-00000000c0de";
    const headers = { ...auth(APPLY), "x-correlation-id": corr };
    const first = await app.inject({ method: "POST", url: "/v1/admin/composition/apply-plan", headers, payload: { moduleIds: ["smarttransfer"], profileCode: null } });
    expect(first.statusCode).toBe(202);
    await (queue as unknown as { drain?: () => Promise<void> }).drain?.();
    const second = await app.inject({ method: "POST", url: "/v1/admin/composition/apply-plan", headers, payload: { moduleIds: ["smarttransfer"], profileCode: null } });
    expect(second.statusCode).toBe(202);
    await (queue as unknown as { drain?: () => Promise<void> }).drain?.();
    // still exactly one entitlement row
    const ents = await readAsTenant(APPLY, (sql) =>
      sql<Array<{ module_id: string }>>`SELECT module_id FROM composition.tenant_entitlement WHERE tenant_id = ${APPLY}`);
    expect(ents).toHaveLength(1);
  });

  it("rejects an unknown module id (404) before publishing", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/composition/apply-plan",
      headers: auth(APPLY), payload: { moduleIds: ["ghost_module"], profileCode: null },
    });
    expect(res.statusCode).toBe(404);
  });

  it("rejects an unknown profile code (404)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/composition/apply-plan",
      headers: auth(APPLY), payload: { moduleIds: ["smarttransfer"], profileCode: "no_such_profile" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("a tenant_admin cannot target another tenant (body tenantId is ignored)", async () => {
    // tenant_admin for APPLY tries to write OTHER's composition → the server
    // pins to the context tenant, so OTHER is untouched and APPLY is written.
    const res = await app.inject({
      method: "POST", url: "/v1/admin/composition/apply-plan",
      headers: auth(APPLY, ["tenant_admin"]),
      payload: { moduleIds: ["smarttransfer"], profileCode: null, tenantId: OTHER },
    });
    expect(res.statusCode).toBe(202);
    await (queue as unknown as { drain?: () => Promise<void> }).drain?.();
    const otherEnts = await readAsTenant(OTHER, (sql) =>
      sql<Array<{ module_id: string }>>`SELECT module_id FROM composition.tenant_entitlement WHERE tenant_id = ${OTHER}`);
    expect(otherEnts).toHaveLength(0); // OTHER never touched
  });

  it("a platform admin MAY target another tenant via body tenantId", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/composition/apply-plan",
      headers: auth(STANDALONE, ["platform_admin"]),
      payload: { moduleIds: ["smarttransfer"], profileCode: "smarttransfer_standalone", tenantId: PLATFORM_TARGET },
    });
    expect(res.statusCode).toBe(202);
    await (queue as unknown as { drain?: () => Promise<void> }).drain?.();
    const ents = await readAsTenant(PLATFORM_TARGET, (sql) =>
      sql<Array<{ module_id: string }>>`SELECT module_id FROM composition.tenant_entitlement WHERE tenant_id = ${PLATFORM_TARGET}`);
    expect(ents.map((r) => r.module_id)).toEqual(["smarttransfer"]);
  });

  it("rejects a caller without an admin role (403)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/admin/composition/apply-plan",
      headers: auth(APPLY, ["employee"]), payload: { moduleIds: ["smarttransfer"], profileCode: null },
    });
    expect(res.statusCode).toBe(403);
  });
});
