/**
 * GET /v1/tenants -- platform-admin tenant directory (real DB, real Fastify).
 *  - role gate: only super_admin / platform_admin (tenant_admin, basic user -> 403; no token -> 401)
 *  - cross-tenant: a platform admin sees tenants other than their own, via the
 *    SECURITY DEFINER function (RLS on tenant.tenants stays FORCE)
 *  - tenant isolation: the tenant-scoped read path still sees only its own row
 *  - search / pagination / LIKE-wildcard escaping
 *  - every call is audited through the outbox
 *  - contract: the real response satisfies the web schema and matches the web fixture's shape
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq, and } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { adminTenantDirectoryResponseSchema } from "@civitasone/schemas";
import type { FastifyInstance } from "fastify";
import { db, sqlClient } from "../src/shared/db.js";
import { tenants } from "../src/modules/tenant/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import * as repo from "../src/modules/tenant/repo.js";

const { buildApp } = await import("../src/app.js");

const SECRET = process.env.JWT_SECRET as string;
const RUN = randomUUID().slice(0, 8);
const A = randomUUID();
const B = randomUUID();
const C = randomUUID();
const ADMIN_TENANT = randomUUID();
const ACTOR = randomUUID();
const bearer = (roles: string[], tid: string) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, roles, tid } as never, SECRET)}`,
});

async function seed(id: string, name: string, domain: string, createdAt: Date) {
  await runWithTenant(id, () => db.transaction((tx) => tx.insert(tenants).values({
    id, tenantId: id, name, domain, edition: "govt", status: "active",
    region: "ap-south-1", residency: "IN", createdBy: ACTOR, updatedBy: ACTOR, createdAt,
  })));
}
async function cleanup() {
  for (const t of [A, B, C]) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(tenants).where(eq(tenants.id, t));
    }));
  }
  await runWithTenant(ADMIN_TENANT, () => db.transaction((tx) => tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, ADMIN_TENANT))));
}

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await cleanup();
  await seed(A, `Alpha-${RUN}`, `alpha-${RUN}.example.test`, new Date("2026-01-03T00:00:00Z"));
  await seed(B, `Beta-${RUN}`, `beta-${RUN}.example.test`, new Date("2026-01-02T00:00:00Z"));
  await seed(C, `100%_${RUN}`, `pct-${RUN}.example.test`, new Date("2026-01-01T00:00:00Z"));
});
afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

const list = (qs: string, headers: Record<string, string>) =>
  app.inject({ method: "GET", url: `/v1/tenants${qs}`, headers });

describe("GET /v1/tenants -- role gate", () => {
  it("401 without a token", async () => {
    expect((await list("", {})).statusCode).toBe(401);
  });
  it.each(["tenant_admin", "employee", "auditor"])("403 for %s", async (role) => {
    const res = await list("", bearer([role], A));
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain(`beta-${RUN}`);
  });
  it.each(["super_admin", "platform_admin"])("200 for %s", async (role) => {
    expect((await list("", bearer([role], ADMIN_TENANT))).statusCode).toBe(200);
  });
});

describe("GET /v1/tenants -- cross-tenant directory", () => {
  it("a platform admin (tenant with no row of its own) sees every tenant (none its own), newest first", async () => {
    const res = await list(`?q=-${RUN}`, bearer(["platform_admin"], ADMIN_TENANT));
    const body = res.json() as { data: Array<{ id: string }>; total: number };
    expect(body.data.map((r) => r.id)).toEqual([A, B, C]);
    expect(body.total).toBe(3);
  });

  it("tenant RLS is untouched: the tenant-scoped read still sees only its own row", async () => {
    expect((await repo.findById(A))?.id).toBe(A);
    const crossRead = await runWithTenant(A, () => db.transaction((tx) => tx.select().from(tenants).where(eq(tenants.id, B))));
    expect(crossRead).toHaveLength(0);
  });

  it("search matches name or domain, case-insensitively", async () => {
    const byName = (await list(`?q=ALPHA-${RUN}`, bearer(["super_admin"], ADMIN_TENANT))).json() as { data: Array<{ id: string }> };
    expect(byName.data.map((r) => r.id)).toEqual([A]);
    const byDomain = (await list(`?q=beta-${RUN}.example`, bearer(["super_admin"], ADMIN_TENANT))).json() as { data: Array<{ id: string }> };
    expect(byDomain.data.map((r) => r.id)).toEqual([B]);
  });

  it("LIKE wildcards in the search are literals, not patterns", async () => {
    const pct = (await list(`?q=${encodeURIComponent("100%_")}`, bearer(["super_admin"], ADMIN_TENANT))).json() as { data: Array<{ id: string }> };
    expect(pct.data.map((r) => r.id)).toEqual([C]);
    const wild = (await list(`?q=${encodeURIComponent("%")}`, bearer(["super_admin"], ADMIN_TENANT))).json() as { data: Array<{ id: string }> };
    expect(wild.data.map((r) => r.id)).toEqual([C]);
  });

  it("paginates with limit/offset and reports the full match total", async () => {
    const h = bearer(["super_admin"], ADMIN_TENANT);
    const p1 = (await list(`?q=${RUN}&limit=1&offset=0`, h)).json() as { data: Array<{ id: string }>; total: number; limit: number; offset: number };
    const p2 = (await list(`?q=${RUN}&limit=1&offset=1`, h)).json() as { data: Array<{ id: string }>; total: number };
    expect(p1.data.map((r) => r.id)).toEqual([A]);
    expect(p2.data.map((r) => r.id)).toEqual([B]);
    expect(p1.total).toBe(3);
    expect(p1.limit).toBe(1);
  });

  it("restores FORCE row level security on tenant.tenants after the list call", async () => {
    expect((await list(`?q=${RUN}`, bearer(["super_admin"], ADMIN_TENANT))).statusCode).toBe(200);
    const rows = await sqlClient`SELECT relforcerowsecurity AS f FROM pg_class WHERE oid = 'tenant.tenants'::regclass`;
    expect(rows[0]?.f).toBe(true);
  });

  it("rejects an out-of-range limit", async () => {
    expect((await list("?limit=501", bearer(["super_admin"], ADMIN_TENANT))).statusCode).toBe(400);
  });

  it("never exposes infrastructure refs or settings", async () => {
    const res = await list(`?q=${RUN}`, bearer(["super_admin"], ADMIN_TENANT));
    expect(res.body).not.toMatch(/dbDsnRef|kmsKeyRef|db_dsn_ref|kms_key_ref|settings/);
  });
});

describe("GET /v1/tenants -- audit", () => {
  it("records a list_all_tenants audit event under the caller's tenant", async () => {
    await list(`?q=audit-${RUN}`, bearer(["platform_admin"], ADMIN_TENANT));
    const rows = await runWithTenant(ADMIN_TENANT, () => db.transaction((tx) => tx.select().from(outboxMessages)
      .where(and(eq(outboxMessages.tenantId, ADMIN_TENANT), eq(outboxMessages.topic, "audit.event.record")))));
    const hit = rows.find((r) => (r.payload as { action?: string; metadata?: { q?: string } }).action === "list_all_tenants"
      && (r.payload as { metadata?: { q?: string } }).metadata?.q === `audit-${RUN}`);
    expect(hit).toBeTruthy();
    expect(hit!.actorId).toBe(ACTOR);
  });

  it("a denied call writes no audit row", async () => {
    await list(`?q=denied-${RUN}`, bearer(["tenant_admin"], ADMIN_TENANT));
    const rows = await runWithTenant(ADMIN_TENANT, () => db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, ADMIN_TENANT))));
    expect(rows.some((r) => (r.payload as { metadata?: { q?: string } }).metadata?.q === `denied-${RUN}`)).toBe(false);
  });
});

describe("GET /v1/tenants -- contract with the /admin/tenants screen", () => {
  it("the real response satisfies the web schema and has the fixture's exact shape", async () => {
    const res = await list(`?q=${RUN}`, bearer(["super_admin"], ADMIN_TENANT));
    const body = res.json();
    expect(adminTenantDirectoryResponseSchema.safeParse(body).success).toBe(true);
    const fixture = JSON.parse(readFileSync(new URL("../../../apps/web/src/app/_data/__fixtures__/tenants-list.json", import.meta.url), "utf8"));
    expect(Object.keys(body).sort()).toEqual(Object.keys(fixture).sort());
    expect(Object.keys(body.data[0]).sort()).toEqual(Object.keys(fixture.data[0]).sort());
    expect(adminTenantDirectoryResponseSchema.safeParse(fixture).success).toBe(true);
  });
});
