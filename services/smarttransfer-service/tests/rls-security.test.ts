/**
 * SmartTransfer-service — RLS security proof (SmartTransfer OS, ST-M01-15b).
 *
 * Spec §14 (RLS; cross-tenant leakage testing). D-ST-04 (one tenant per
 * authority; districts are jurisdiction scopes), D-ST-10 (movement entities are
 * SmartTransfer's own, FORCE-RLS tables). This is the SECURITY companion to
 * tests/rls-isolation.test.ts (which proves per-table cross-tenant isolation
 * via the ORM) and tests/read-routes.test.ts (jurisdiction scoping on the GET
 * by id). Here we add, for the ST-M01-15 security row:
 *
 *   1. FORCE RLS asserted directly from pg_class for EVERY smarttransfer table
 *      — the 12 movement tables AND the two tenant-scoped infra tables
 *      (_outbox.messages, _inbox.command_results) — plus a tenant_isolation
 *      policy from pg_policies. relforcerowsecurity must be TRUE (FORCE, not
 *      just ENABLE), so even the table-owning NOBYPASSRLS role is bound.
 *   2. JURISDICTION SCOPING ON A LIST ROUTE: within ONE tenant, a cycle created
 *      in jurisdiction B is ABSENT from a jurisdiction-A caller's list and
 *      PRESENT for a tenant-level caller (no jurisdiction claim) — house rule 9.
 *   3. Cross-tenant WRITE rejection (policy WITH CHECK) on a representative
 *      table, from the runtime role.
 *
 * Runs against the real civitas_smarttransfer DB as the smarttransfer_svc
 * (NOBYPASSRLS) runtime role via the service's own pool, exactly like
 * tests/rls-isolation.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { queue } from "../src/shared/infra.js";
import { db, sqlClient } from "../src/shared/db.js";
import { registerMovementConsumers } from "../src/modules/movement/consumer.js";
import { cycles } from "../src/modules/movement/schema.js";
import { authHeader, stubCompositionFetch } from "./_helpers.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();
const JURIS_A = randomUUID();
const JURIS_B = randomUUID();

// Every FORCE-RLS table smarttransfer-service owns: 12 movement tables in the
// `smarttransfer` schema + the 2 tenant-scoped infra tables.
const RLS_TABLES: Array<{ schema: string; table: string }> = [
  { schema: "smarttransfer", table: "cycles" },
  { schema: "smarttransfer", table: "requests" },
  { schema: "smarttransfer", table: "preferences" },
  { schema: "smarttransfer", table: "preference_items" },
  { schema: "smarttransfer", table: "scenarios" },
  { schema: "smarttransfer", table: "runs" },
  { schema: "smarttransfer", table: "assignments" },
  { schema: "smarttransfer", table: "orders" },
  { schema: "smarttransfer", table: "relieving_records" },
  { schema: "smarttransfer", table: "joining_records" },
  { schema: "smarttransfer", table: "appeals" },
  { schema: "smarttransfer", table: "evidence" },
  { schema: "_outbox", table: "messages" },
  { schema: "_inbox", table: "command_results" },
];

let app: FastifyInstance;
let restoreFetch: () => void;

beforeAll(async () => {
  restoreFetch = stubCompositionFetch(() => ({ configured: true, data: [{ name: "smarttransfer" }] }));
  app = await buildApp();
  await app.ready();
  registerMovementConsumers(queue);
});

afterAll(async () => {
  restoreFetch();
  await app.close();
  await sqlClient.end();
});

async function createCycle(juris: string[] | undefined, name: string): Promise<void> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/smarttransfer/cycles",
    headers: authHeader(TENANT, ACTOR, ["smarttransfer_admin"], juris),
    payload: {
      name,
      movementTypeId: randomUUID(),
      calendar: {
        opensAt: "2026-01-01T00:00:00.000Z",
        freezesAt: "2026-02-01T00:00:00.000Z",
        closesAt: "2026-03-01T00:00:00.000Z",
      },
    },
  });
  expect(res.statusCode).toBe(202);
  await queue.drain();
}

async function listNames(juris: string[] | undefined): Promise<string[]> {
  const res = await app.inject({
    method: "GET",
    url: "/v1/smarttransfer/cycles",
    headers: authHeader(TENANT, ACTOR, ["smarttransfer_admin"], juris),
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { data: Array<{ name: string }> }).data.map((c) => c.name);
}

describe("smarttransfer RLS — FORCE RLS asserted from pg_class (every table)", () => {
  it("the pool connects as the NOBYPASSRLS smarttransfer_svc role", async () => {
    const [row] = await sqlClient<{ u: string; bypass: boolean }[]>`
      select current_user as u,
             (select rolbypassrls from pg_roles where rolname = current_user) as bypass`;
    expect(row!.u).toBe("smarttransfer_svc");
    expect(row!.bypass).toBe(false);
  });

  for (const { schema, table } of RLS_TABLES) {
    it(`${schema}.${table}: relrowsecurity AND relforcerowsecurity are both true`, async () => {
      const rows = await sqlClient<{ relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
        select relrowsecurity, relforcerowsecurity
          from pg_class
         where oid = ${`${schema}.${table}`}::regclass`;
      expect(rows.length).toBe(1);
      expect(rows[0]!.relrowsecurity, `${schema}.${table} ENABLE RLS`).toBe(true);
      expect(rows[0]!.relforcerowsecurity, `${schema}.${table} FORCE RLS`).toBe(true);
    });

    it(`${schema}.${table}: a tenant_isolation policy exists`, async () => {
      const rows = await sqlClient<{ policyname: string }[]>`
        select policyname from pg_policies
         where schemaname = ${schema} and tablename = ${table}`;
      expect(rows.map((r) => r.policyname)).toContain("tenant_isolation");
    });
  }
});

describe("smarttransfer RLS — jurisdiction scoping on the cycles LIST route", () => {
  beforeAll(async () => {
    await createCycle([JURIS_A], "JS cycle in A");
    await createCycle([JURIS_B], "JS cycle in B");
  });

  it("a jurisdiction-A caller's list contains A's cycle but NOT B's", async () => {
    const names = await listNames([JURIS_A]);
    expect(names).toContain("JS cycle in A");
    expect(names).not.toContain("JS cycle in B");
  });

  it("a jurisdiction-B caller's list contains B's cycle but NOT A's", async () => {
    const names = await listNames([JURIS_B]);
    expect(names).toContain("JS cycle in B");
    expect(names).not.toContain("JS cycle in A");
  });

  it("a tenant-level caller (no jurisdiction claim) sees both", async () => {
    const names = await listNames(undefined);
    expect(names).toContain("JS cycle in A");
    expect(names).toContain("JS cycle in B");
  });
});

describe("smarttransfer RLS — cross-tenant write is rejected by WITH CHECK", () => {
  it("scoped to tenant A, inserting a cycle stamped tenant B is rejected", async () => {
    const other = randomUUID();
    await expect(
      runWithTenant(TENANT, () =>
        db.transaction((tx) =>
          tx.insert(cycles).values({
            id: randomUUID(),
            tenantId: other, // claims a DIFFERENT tenant than the GUC → WITH CHECK fails
            name: "cross tenant",
            status: "draft",
            createdBy: ACTOR,
            updatedBy: ACTOR,
          }),
        ),
      ),
    ).rejects.toThrow();
  });
});
