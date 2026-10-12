/**
 * Internal composition endpoint (service-to-service) that feeds the gateway
 * module-guard. Verifies: un-onboarded tenants are `configured:false` (gateway
 * fails open), onboarded tenants return the dependency-resolved allow-list
 * projected to the gateway's route-key vocabulary. In test env
 * INTERNAL_SERVICE_SECRET is unset, so the internal-caller path can never
 * validate (fail-closed — see internal-auth-flag.test.ts for the dedicated
 * regression coverage) and every request here goes through the normal
 * super-admin JWT fallback via auth() below.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

const { buildApp } = await import("../src/app.js");
const { sqlClient } = await import("../src/shared/db.js");
const { queue } = await import("../src/shared/infra.js");
const { registerCompositionConsumers } = await import("../src/modules/composition/consumer.js");
async function drain(): Promise<void> {
  const q = queue as unknown as { drain?: () => Promise<void> };
  expect(typeof q.drain).toBe("function");
  await q.drain!();
}

const ONBOARDED = "cccccccc-dddd-4000-8000-0000000000f7";
const VIRGIN = "cccccccc-dddd-4000-8000-0000000000f8";
const ADMIN = "11111111-eeee-4000-8000-000000000001";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANTS = [ONBOARDED, VIRGIN];

let app: FastifyInstance;
let signToken: (p: Record<string, unknown>, s: string, ttl: number) => string;
// The internal endpoint accepts either a valid INTERNAL_SERVICE_SECRET (used by
// the gateway) OR super-admin JWT fallback. INTERNAL_SERVICE_SECRET is injected
// into the app after import here, so we exercise the endpoint via the JWT
// fallback — the same way the existing modules-list route tests do.
const auth = () => ({ authorization: `Bearer ${signToken({ sub: ADMIN, tid: ONBOARDED, roles: ["super_admin"], sid: "s" }, SECRET, 3600)}` });

beforeAll(async () => {
  // The set-enforcement-mode consumer normally runs in src/worker.ts.
  registerCompositionConsumers(queue);
  await queue.start();
  ({ signToken } = await import("@civitasone/auth"));
  app = await buildApp();
  for (const t of TENANTS) {
    await sqlClient`DELETE FROM composition.tenant_entitlement WHERE tenant_id = ${t}`;
    await sqlClient`DELETE FROM composition.tenant_profile WHERE tenant_id = ${t}`;
  }
  // ST-M01-02: ensure no enforcement-mode rows leak in from a prior run (the
  // default-off assertion depends on a clean slate). The table is FORCE-RLS, so
  // a plain DELETE with no app.tenant_id GUC matches nothing — each delete runs
  // in a tx with the tenant GUC set. Covers the standalone tenant too.
  const STANDALONE_TID = "cccccccc-dddd-4000-8000-0000000000fa";
  for (const t of [ONBOARDED, VIRGIN, STANDALONE_TID]) {
    await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${t}, true)`;
      await tx`DELETE FROM composition.tenant_enforcement_mode WHERE tenant_id = ${t}`;
      await tx`DELETE FROM composition.tenant_entitlement WHERE tenant_id = ${t}`;
      await tx`DELETE FROM composition.tenant_profile WHERE tenant_id = ${t}`;
    });
  }
  // ONBOARDED gets the govt profile (widest module set)
  const tok = signToken({ sub: ADMIN, tid: ONBOARDED, roles: ["tenant_admin"], sid: "s" }, SECRET, 3600);
  await app.inject({
    method: "POST",
    url: "/v1/admin/composition/onboard",
    headers: { authorization: `Bearer ${tok}` },
    payload: { profile: "govt_dept" },
  });
});
afterAll(async () => {
  for (const t of TENANTS) {
    await sqlClient`DELETE FROM composition.tenant_entitlement WHERE tenant_id = ${t}`;
    await sqlClient`DELETE FROM composition.tenant_profile WHERE tenant_id = ${t}`;
  }
  await app.close();
  await queue.stop();
  await sqlClient.end();
});

describe("GET /v1/admin/composition/internal/:tenantId/modules", () => {
  it("un-onboarded tenant → configured:false (gateway fails open)", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/admin/composition/internal/${VIRGIN}/modules`, headers: auth() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.configured).toBe(false);
    expect(body.data).toEqual([]);
  });

  it("onboarded govt tenant → resolved allow-list in gateway route-keys", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/admin/composition/internal/${ONBOARDED}/modules`, headers: auth() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.configured).toBe(true);
    const keys = body.data.map((m: { name: string }) => m.name);
    // ST-M01-04b: the HR cluster now projects to the SPLIT sub-keys, not a
    // single coarse "hrms". A govt tenant has the full HR module set, so it
    // reaches workforce_core (core HRMS) + every non-core sub-key; payroll /
    // finance / procurement present; core → workflow.
    expect(keys).toEqual(
      expect.arrayContaining([
        "workforce_core",
        "hrms-leave",
        "hrms-attendance",
        "hrms-recruitment",
        "hrms-appraisal",
        "hrms-self-service",
        "payroll",
        "finance",
        "procurement",
        "workflow",
      ]),
    );
    // the coarse "hrms" key is gone after the split
    expect(keys).not.toContain("hrms");
    // govt has no CRM by default → "crm" absent
    expect(keys).not.toContain("crm");
  });

  it("rejects a malformed tenant id (400)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/composition/internal/not-a-uuid/modules", headers: auth() });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/admin/composition/my-modules (web nav visibility)", () => {
  // A NON-admin token for the onboarded tenant — the nav is shown to every user.
  const navAuth = (tid: string) => ({ authorization: `Bearer ${signToken({ sub: ADMIN, tid, roles: ["employee"], sid: "s" }, SECRET, 3600)}` });

  it("returns the caller's resolved modules for any authenticated role", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/composition/my-modules", headers: navAuth(ONBOARDED) });
    expect(res.statusCode).toBe(200);
    const keys = res.json().data.map((m: { name: string }) => m.name);
    // ST-M01-04b: HR cluster split into per-prefix keys.
    expect(keys).toEqual(expect.arrayContaining(["workforce_core", "hrms-leave", "finance", "payroll"]));
    expect(keys).not.toContain("hrms");
  });

  it("returns an empty list for an un-onboarded tenant (web shows all)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/composition/my-modules", headers: navAuth(VIRGIN) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it("requires authentication (401 without a token)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/composition/my-modules" });
    expect(res.statusCode).toBe(401);
  });
});

// ── ST-M01-02 / D-ST-24 — per-tenant enforcement mode ──────────────────────
describe("enforcement mode (FF-03, D-ST-24)", () => {
  const STANDALONE = "cccccccc-dddd-4000-8000-0000000000fa";
  const superAuth = (tid: string) => ({ authorization: `Bearer ${signToken({ sub: ADMIN, tid, roles: ["super_admin"], sid: "s" }, SECRET, 3600)}` });

  afterAll(async () => {
    for (const t of [STANDALONE, ONBOARDED]) {
      await sqlClient.begin(async (tx) => {
        await tx`SELECT set_config('app.tenant_id', ${t}, true)`;
        await tx`DELETE FROM composition.tenant_enforcement_mode WHERE tenant_id = ${t}`;
        await tx`DELETE FROM composition.tenant_entitlement WHERE tenant_id = ${t}`;
        await tx`DELETE FROM composition.tenant_profile WHERE tenant_id = ${t}`;
      });
    }
  });

  it("internal projection carries mode:off by default for an onboarded tenant", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/admin/composition/internal/${ONBOARDED}/modules`, headers: auth() });
    expect(res.json().mode).toBe("off");
  });

  it("a tenant on the smarttransfer_standalone profile resolves to mode:enforce", async () => {
    // Onboard the standalone profile (seeded by migration 0049).
    const tok = signToken({ sub: ADMIN, tid: STANDALONE, roles: ["tenant_admin"], sid: "s" }, SECRET, 3600);
    const onboard = await app.inject({
      method: "POST", url: "/v1/admin/composition/onboard",
      headers: { authorization: `Bearer ${tok}` }, payload: { profile: "smarttransfer_standalone" },
    });
    expect(onboard.statusCode).toBe(200);
    const res = await app.inject({ method: "GET", url: `/v1/admin/composition/internal/${STANDALONE}/modules`, headers: superAuth(STANDALONE) });
    expect(res.statusCode).toBe(200);
    expect(res.json().mode).toBe("enforce");
    const keys = res.json().data.map((m: { name: string }) => m.name);
    // ST-M01-04b: standalone resolves smarttransfer + workforce_core + core
    // kernel only. The sub-route key split means its OWN gateway keys include
    // `workforce_core` (the core HRMS surface) but NONE of the non-core HRMS
    // sub-keys and none of the finance/HR SKUs. This is exactly M01 exit
    // criterion 3 at the projection layer: no leave/attendance/recruitment/
    // payroll-facing surface is reachable for the standalone SKU.
    expect(keys).toContain("smarttransfer");
    expect(keys).toContain("workforce_core");
    // the coarse "hrms" door is gone, and no non-core HRMS sub-key is granted
    expect(keys).not.toContain("hrms");
    for (const blocked of [
      "hrms-leave",
      "hrms-attendance",
      "hrms-recruitment",
      "hrms-appraisal",
      "hrms-payroll",
      "hrms-self-service",
      "payroll",
      "finance",
      "procurement",
      "crm",
    ]) {
      expect(keys, `standalone must NOT get ${blocked}`).not.toContain(blocked);
    }
  });

  it("PUT sets an explicit mode and GET reads it back (super-admin only)", async () => {
    const put = await app.inject({
      method: "PUT", url: `/v1/admin/composition/${ONBOARDED}/enforcement-mode`,
      headers: superAuth(ONBOARDED), payload: { mode: "shadow" },
    });
    expect(put.statusCode).toBe(202); // CQRS: command accepted, consumer writes
    await drain();
    const get = await app.inject({ method: "GET", url: `/v1/admin/composition/${ONBOARDED}/enforcement-mode`, headers: superAuth(ONBOARDED) });
    expect(get.json().mode).toBe("shadow");
    // and the explicit row now overrides into the projection
    const proj = await app.inject({ method: "GET", url: `/v1/admin/composition/internal/${ONBOARDED}/modules`, headers: auth() });
    expect(proj.json().mode).toBe("shadow");
  });

  it("an explicit enforce row overrides even the standalone-profile default direction", async () => {
    const put = await app.inject({
      method: "PUT", url: `/v1/admin/composition/${STANDALONE}/enforcement-mode`,
      headers: superAuth(STANDALONE), payload: { mode: "off" },
    });
    expect(put.statusCode).toBe(202);
    await drain();
    const res = await app.inject({ method: "GET", url: `/v1/admin/composition/internal/${STANDALONE}/modules`, headers: superAuth(STANDALONE) });
    // explicit off wins over the standalone-profile enforce default
    expect(res.json().mode).toBe("off");
  });

  it("consumer refuses `enforce` for a tenant that is not composed (no row written, mode stays off)", async () => {
    // Publish the command directly: the route also pre-checks readiness, so this
    // exercises the consumer's own re-check (the 202-to-consume race).
    const { COMMANDS } = await import("../src/topics.js");
    const { randomUUID } = await import("node:crypto");
    await queue.publish(COMMANDS.compositionSetEnforcementMode, {
      messageId: randomUUID(), type: COMMANDS.compositionSetEnforcementMode, tenantId: VIRGIN,
      actorId: ADMIN, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { tenantId: VIRGIN, mode: "enforce" },
    } as never);
    await drain();
    const rows = await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${VIRGIN}, true)`;
      return tx`SELECT mode FROM composition.tenant_enforcement_mode WHERE tenant_id = ${VIRGIN}`;
    });
    expect(rows.length).toBe(0);
  });

  it("rejects a bad mode value (400)", async () => {
    const res = await app.inject({
      method: "PUT", url: `/v1/admin/composition/${ONBOARDED}/enforcement-mode`,
      headers: superAuth(ONBOARDED), payload: { mode: "nonsense" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("requires super/platform admin to set the mode (403 for tenant_admin)", async () => {
    const taTok = signToken({ sub: ADMIN, tid: ONBOARDED, roles: ["tenant_admin"], sid: "s" }, SECRET, 3600);
    const res = await app.inject({
      method: "PUT", url: `/v1/admin/composition/${ONBOARDED}/enforcement-mode`,
      headers: { authorization: `Bearer ${taTok}` }, payload: { mode: "enforce" },
    });
    expect(res.statusCode).toBe(403);
  });
});
