/**
 * Module Composition routes — integration against a real Postgres with RLS.
 *   onboard (org profile) → composition persists → enable pulls deps →
 *   disable is blocked by dependents → RLS isolates tenants → authz.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const { buildApp } = await import("../src/app.js");
const { sqlClient } = await import("../src/shared/db.js");

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "cccccccc-dddd-4000-8000-0000000000e1";
const OTHER = "cccccccc-dddd-4000-8000-0000000000e2";
const FRESH = "cccccccc-dddd-4000-8000-0000000000e3";
const ENABLE = "cccccccc-dddd-4000-8000-0000000000e4"; // dedicated to the enable/disable flow
const ADMIN = "11111111-eeee-4000-8000-000000000001";
const TENANTS = [TENANT, OTHER, FRESH, ENABLE];

function token(actorId: string, roles: string[] = ["tenant_admin"], tenantId = TENANT): string {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-comp" }, SECRET, 3600);
}
function auth(actorId: string, roles?: string[], tenantId?: string) {
  return { authorization: `Bearer ${token(actorId, roles, tenantId)}` };
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  // clean slate for the tenants under test
  for (const t of TENANTS) {
    await sqlClient`DELETE FROM composition.tenant_entitlement WHERE tenant_id = ${t}`;
    await sqlClient`DELETE FROM composition.tenant_profile WHERE tenant_id = ${t}`;
  }
});
afterAll(async () => {
  for (const t of TENANTS) {
    await sqlClient`DELETE FROM composition.tenant_entitlement WHERE tenant_id = ${t}`;
    await sqlClient`DELETE FROM composition.tenant_profile WHERE tenant_id = ${t}`;
  }
  await app.close();
  await sqlClient.end();
});

const sourceMap = (body: any): Record<string, string> =>
  Object.fromEntries(body.modules.map((m: any) => [m.id, m.source]));

describe("GET /v1/admin/composition/registry", () => {
  it("returns the seeded module graph + org profiles", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/composition/registry", headers: auth(ADMIN) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const payroll = body.modules.find((m: any) => m.id === "payroll");
    expect(payroll.hardDeps).toEqual(expect.arrayContaining(["employee", "config", "finance"]));
    expect(body.profiles.map((p: any) => p.code)).toEqual(expect.arrayContaining(["govt_dept", "psu", "small_office"]));
  });
});

describe("onboarding an org profile", () => {
  it("govt profile sets terminology/rule-packs and default modules", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/composition/onboard",
      headers: auth(ADMIN),
      payload: { profile: "govt_dept" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.profile.code).toBe("govt_dept");
    expect(body.profile.rulePacks.pay).toBe("7th_cpc");
    expect(body.profile.terminology.post).toBe("Cadre / Pay Level");
    expect(body.profile.reservation).toBe(true);
    const src = sourceMap(body);
    expect(src["payroll"]).toBe("user");
    expect(src["employee"]).toBe("user");
    expect(src["config"]).toBe("core");
  });

  it("persists — a subsequent GET returns the same composition", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/composition/tenant", headers: auth(ADMIN) });
    expect(res.statusCode).toBe(200);
    expect(res.json().profile.code).toBe("govt_dept");
    expect(res.json().counts.user).toBeGreaterThan(5);
  });

  it("section-8 profile drops reservation and pension-side modules", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/composition/onboard",
      headers: auth(ADMIN, ["tenant_admin"], OTHER),
      payload: { profile: "small_office" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.profile.reservation).toBe(false);
    expect(body.profile.rulePacks.pay).toBe("ctc");
    const src = sourceMap(body);
    expect(src["recruitment"]).toBeUndefined(); // not in small_office defaults
    expect(src["separation"]).toBeUndefined();
  });

  it("rejects an unknown profile", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/composition/onboard",
      headers: auth(ADMIN, ["tenant_admin"], FRESH),
      payload: { profile: "does_not_exist" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("enable / disable with dependency resolution (fresh tenant)", () => {
  it("enabling payroll on an empty tenant pulls employee + finance as deps", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/composition/modules/payroll/enable",
      headers: auth(ADMIN, ["tenant_admin"], ENABLE),
    });
    expect(res.statusCode).toBe(200);
    const src = sourceMap(res.json());
    expect(src["payroll"]).toBe("user");
    expect(src["employee"]).toBe("dep");
    expect(src["finance"]).toBe("dep");
    expect(src["attendance"]).toBeUndefined(); // soft dep, not auto-enabled
  });

  it("disabling employee is blocked (409) while payroll depends on it", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/composition/modules/employee/disable",
      headers: auth(ADMIN, ["tenant_admin"], ENABLE),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error?.code ?? res.json().code).toBe("COMPOSITION_BLOCKED");
  });

  it("disabling payroll then employee succeeds and GCs finance", async () => {
    const d1 = await app.inject({ method: "POST", url: "/v1/admin/composition/modules/payroll/disable", headers: auth(ADMIN, ["tenant_admin"], ENABLE) });
    expect(d1.statusCode).toBe(200);
    expect(d1.json().modules.find((m: any) => m.id === "finance")).toBeUndefined();
    const d2 = await app.inject({ method: "POST", url: "/v1/admin/composition/modules/employee/disable", headers: auth(ADMIN, ["tenant_admin"], ENABLE) });
    expect(d2.statusCode).toBe(200);
    expect(d2.json().counts.user).toBe(0);
  });

  it("rejects an unknown module id", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/admin/composition/modules/ghost/enable", headers: auth(ADMIN, ["tenant_admin"], ENABLE) });
    expect(res.statusCode).toBe(404);
  });
});

// Read raw rows with the RLS GUC set to a specific tenant (mirrors central-config test).
function readAsTenant<T>(tenantId: string, run: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${tenantId}, true)`;
    return run(sql as typeof sqlClient);
  }) as Promise<T>;
}

describe("RLS tenant isolation", () => {
  it("a tenant never sees another tenant's entitlements", async () => {
    // FRESH was fully disabled above; onboard it as govt (12 defaults), then read as OTHER.
    await app.inject({ method: "POST", url: "/v1/admin/composition/onboard", headers: auth(ADMIN, ["tenant_admin"], FRESH), payload: { profile: "govt_dept" } });
    const other = await app.inject({ method: "GET", url: "/v1/admin/composition/tenant", headers: auth(ADMIN, ["tenant_admin"], OTHER) });
    expect(other.statusCode).toBe(200);
    // OTHER is small_office (7 defaults) — must NOT reflect FRESH's govt set (12 defaults)
    expect(other.json().profile.code).toBe("small_office");
    expect(other.json().counts.user).toBeLessThan(12);

    // FORCE RLS proof: an UNSCOPED read (no app.tenant_id GUC) is fail-closed → 0 rows,
    // even though the rows exist — a SCOPED read for FRESH sees all 12.
    const unscoped = await sqlClient`SELECT count(*)::int AS n FROM composition.tenant_entitlement WHERE tenant_id = ${FRESH}`;
    expect(unscoped[0].n).toBe(0);
    const scoped = await readAsTenant(FRESH, (sql) => sql`SELECT count(*)::int AS n FROM composition.tenant_entitlement WHERE tenant_id = ${FRESH}`);
    expect((scoped as Array<{ n: number }>)[0].n).toBe(12);
    // And FRESH cannot see OTHER's rows even with its own GUC set.
    const crossView = await readAsTenant(FRESH, (sql) => sql`SELECT count(*)::int AS n FROM composition.tenant_entitlement WHERE tenant_id = ${OTHER}`);
    expect((crossView as Array<{ n: number }>)[0].n).toBe(0);
  });
});

describe("authorization", () => {
  it("rejects a caller without an admin role", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/composition/tenant", headers: auth(ADMIN, ["employee"], TENANT) });
    expect(res.statusCode).toBe(403);
  });
});
