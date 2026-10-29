/**
 * FQ12 (UAT items #130-#134) — GET /v1/install/wizards and
 * GET /v1/install/wizards/:id/progress returned 500.
 *
 * orchestrator.* is FORCE RLS. The repo reads used a bare db.transaction(),
 * which only carries the app.tenant_id GUC when an AsyncLocalStorage tenant
 * context is active -- and the onRequest hook (createTenantTxHook) only sets
 * one from an x-tenant-id header the gateway does not send. So the GUC was
 * never set, and the legacy policies from 0004 (rls_*, which cast
 * current_setting('app.tenant_id')::uuid without missing_ok) threw
 * "unrecognized configuration parameter" / `invalid input syntax for type
 * uuid: ""`. The reads now go through runWithTenant like stages/repo.ts, and
 * migration 0018 drops the duplicate legacy policies (tenant_isolation_policy
 * from 0006 already covers the same tables).
 */
import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { wizardDefinitions, stepDefinitions, stepExecutions } from "../src/modules/orchestrator/schema.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();
const WIZARD = randomUUID();

const headers = (tenant = TENANT) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles: ["install_admin"] }, SECRET, 3600)}`,
});

const MIGRATION = new URL("../migrations/0018_drop_legacy_orchestrator_rls_policies.sql", import.meta.url);
const runMigration = () => sqlClient.unsafe(readFileSync(MIGRATION, "utf8"));

async function orchestratorPolicies(): Promise<string[]> {
  const rows = await sqlClient<{ name: string }[]>`
    SELECT c.relname || ':' || p.polname AS name
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'orchestrator' ORDER BY 1`;
  return rows.map((r) => r.name);
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(wizardDefinitions).values({ id: WIZARD, tenantId: TENANT, name: "FQ12 wizard", createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(stepDefinitions).values([
      { tenantId: TENANT, wizardId: WIZARD, stepKey: "one", title: "One", handlerType: "manual", sortOrder: 0, createdBy: ACTOR, updatedBy: ACTOR },
      { tenantId: TENANT, wizardId: WIZARD, stepKey: "two", title: "Two", handlerType: "manual", dependsOn: ["one"], sortOrder: 1, createdBy: ACTOR, updatedBy: ACTOR },
    ]);
    await tx.insert(stepExecutions).values({ tenantId: TENANT, wizardId: WIZARD, stepKey: "one", status: "completed", createdBy: ACTOR, updatedBy: ACTOR });
  }));
});

afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(stepExecutions);
    await tx.delete(stepDefinitions);
    await tx.delete(wizardDefinitions);
  }));
  await app.close();
  await sqlClient.end();
});

describe("FQ12 install-service — wizard reads under FORCE RLS", () => {
  it("GET /v1/install/wizards lists the tenant's wizard (#130)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/install/wizards", headers: headers() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([expect.objectContaining({ id: WIZARD, name: "FQ12 wizard" })]);
  });

  it("GET /v1/install/wizards/:id/progress reads definitions and executions (#131-#134)", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/install/wizards/${WIZARD}/progress`, headers: headers() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ wizardId: WIZARD, total: 2, completed: 1 });
    expect(body.steps.map((s: { stepKey: string }) => s.stepKey)).toEqual(["one", "two"]);
    expect(body.steps[0]).toMatchObject({ stepKey: "one", status: "completed" });
  });

  it("another tenant sees no wizards and gets 404 on the progress", async () => {
    const list = await app.inject({ method: "GET", url: "/v1/install/wizards", headers: headers(OTHER_TENANT) });
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toEqual([]);
    const progress = await app.inject({ method: "GET", url: `/v1/install/wizards/${WIZARD}/progress`, headers: headers(OTHER_TENANT) });
    expect(progress.statusCode).toBe(404);
  });

  it("migration 0018 drops only the legacy rls_* policies and is idempotent", async () => {
    await runMigration();
    await runMigration();
    const policies = await orchestratorPolicies();
    expect(policies.filter((p) => p.includes(":rls_"))).toEqual([]);
    expect(policies).toEqual(expect.arrayContaining([
      "step_definitions:tenant_isolation_policy",
      "step_executions:tenant_isolation_policy",
      "wizard_definitions:tenant_isolation_policy",
    ]));
    // isolation still holds without the legacy policies
    const other = await app.inject({ method: "GET", url: "/v1/install/wizards", headers: headers(OTHER_TENANT) });
    expect(other.json().data).toEqual([]);
    const own = await app.inject({ method: "GET", url: "/v1/install/wizards?limit=7&offset=0", headers: headers() });
    expect(own.json().data).toEqual([expect.objectContaining({ id: WIZARD })]);
  });
});
