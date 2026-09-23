/**
 * GET /v1/admin/sa-dashboard — this route never existed on this service
 * (every request 404'd: `Route GET:/v1/admin/sa-dashboard not found`), even
 * though the frontend has called it since it was built. See the PR
 * description for the full writeup.
 *
 * Real Postgres, real Fastify via app.inject(), no mocks. activeTenants is
 * checked as a genuine BEFORE/AFTER DELTA (not an absolute count) around a
 * real seed of rows across TWO different tenants — proving the platform-wide
 * scopedPlatformRead bypass is real and not just the caller's own tenant (a
 * naive scopedRead-scoped implementation would under-count) — and robust
 * against other test files' tenants that may exist in parallel in the same
 * database (see tests/new-features-tenant-isolation.test.ts's own comment on
 * that).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const { buildApp } = await import("../src/app.js");
const { sqlClient } = await import("../src/shared/db.js");

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

/** Distinct from every other test file's tenants — files run in parallel. */
const T_A = "5ad00000-0000-4000-8000-0000000000a1";
const T_B = "5ad00000-0000-4000-8000-0000000000b1";
const TENANTS = [T_A, T_B];
const ACTOR = "5ad0acc0-0000-4000-8000-000000000001";

function auth(tenantId: string, roles: string[]): { authorization: string } {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-sa-dash" }, SECRET, 3600)}`,
  };
}
const SUPER_ADMIN = (): { authorization: string } => auth(T_A, ["super_admin"]);
const PLATFORM_ADMIN = (): { authorization: string } => auth(T_A, ["platform_admin"]);
const TENANT_ADMIN_ONLY = (): { authorization: string } => auth(T_A, ["tenant_admin"]);

/** Raw SQL with the RLS GUC set — admin_svc is NOBYPASSRLS. Same technique as tests/new-features-tenant-isolation.test.ts's asTenant(). */
function asTenant<T>(tenantId: string, run: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return run(sql as typeof sqlClient);
  }) as Promise<T>;
}

async function seedTenant(
  tenantId: string, id: string, domain: string, status: "active" | "draft" | "suspended",
): Promise<void> {
  await asTenant(tenantId, (sql) => sql`
    INSERT INTO tenants.admin_tenants
      (id, tenant_id, name, domain, edition, status, region, residency, settings, created_by, updated_by, version)
    VALUES
      (${id}, ${tenantId}, ${"SA Dashboard Test " + domain}, ${domain}, 'govt_dept',
       ${status}, 'ap-south-1', 'in', '{}'::jsonb, ${tenantId}, ${tenantId}, 1)
  `);
}

async function wipe(): Promise<void> {
  for (const t of TENANTS) {
    await asTenant(t, (sql) => sql`DELETE FROM tenants.admin_tenants WHERE tenant_id = ${t}`);
  }
}

interface Dashboard {
  activeTenants: number;
  totalUsers: null | number;
  metrics: Array<{ metric: string; category: string; value: string; change: string; status: string }>;
}

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await wipe();
});
afterAll(async () => {
  await wipe();
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/admin/sa-dashboard", () => {
  it("requires super_admin or platform_admin — a tenant_admin-only caller gets 403", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/sa-dashboard", headers: TENANT_ADMIN_ONLY() });
    expect(res.statusCode).toBe(403);
  });

  it("an unauthenticated request is never 200", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/sa-dashboard" });
    expect(res.statusCode).not.toBe(200);
  });

  it("a super_admin caller gets 200 with the real snapshot shape", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/sa-dashboard", headers: SUPER_ADMIN() });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Dashboard;
    expect(typeof body.activeTenants).toBe("number");
    // Honest gap, never a fabricated 0 — see sa-dashboard.ts's file doc: no
    // cross-tenant user count exists anywhere in this codebase.
    expect(body.totalUsers).toBeNull();
    expect(Array.isArray(body.metrics)).toBe(true);
    expect(body.metrics.length).toBeGreaterThan(0);
    for (const m of body.metrics) {
      expect(typeof m.metric).toBe("string");
      expect(typeof m.category).toBe("string");
      expect(typeof m.value).toBe("string");
      expect(["active", "pending", "failed"]).toContain(m.status);
    }
  });

  it("a platform_admin caller also gets 200 (same gate as /v1/admin/operations)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/sa-dashboard", headers: PLATFORM_ADMIN() });
    expect(res.statusCode).toBe(200);
  });

  it("activeTenants is a genuine platform-wide count — proven by a real delta across TWO different tenants", async () => {
    const before = (await app.inject({
      method: "GET", url: "/v1/admin/sa-dashboard", headers: SUPER_ADMIN(),
    })).json() as Dashboard;

    // Two ACTIVE rows in two DIFFERENT tenants, plus one DRAFT row that must
    // NOT count. A naive tenant-scoped (scopedRead-only) implementation, or
    // one that counted every status instead of filtering to 'active', would
    // both fail the delta assertion below.
    await seedTenant(T_A, "5ad0a000-0000-4000-8000-00000000a001", "sa-dash-test-a1.example.gov.in", "active");
    await seedTenant(T_B, "5ad0a000-0000-4000-8000-00000000b001", "sa-dash-test-b1.example.gov.in", "active");
    await seedTenant(T_A, "5ad0a000-0000-4000-8000-00000000a002", "sa-dash-test-a2.example.gov.in", "draft");

    const after = (await app.inject({
      method: "GET", url: "/v1/admin/sa-dashboard", headers: SUPER_ADMIN(),
    })).json() as Dashboard;
    expect(after.activeTenants - before.activeTenants).toBe(2);
  });

  it("metrics reuse the real OperationsSnapshot — matches /v1/admin/operations' own numbers", async () => {
    const [dash, ops] = await Promise.all([
      app.inject({ method: "GET", url: "/v1/admin/sa-dashboard", headers: SUPER_ADMIN() })
        .then((r) => r.json() as Dashboard),
      app.inject({ method: "GET", url: "/v1/admin/operations", headers: SUPER_ADMIN() })
        .then((r) => r.json() as { summary: { onlineProcesses: number; totalProcesses: number; outboxPending: number } }),
    ]);
    const processesRow = dash.metrics.find((m) => m.metric === "Processes online");
    expect(processesRow?.value).toBe(`${ops.summary.onlineProcesses}/${ops.summary.totalProcesses}`);
    const outboxRow = dash.metrics.find((m) => m.metric === "Outbox pending");
    expect(outboxRow?.value).toBe(String(ops.summary.outboxPending));
  });
});
