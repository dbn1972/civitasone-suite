/**
 * Cross-tenant RLS isolation — smarttransfer-service (real Postgres).
 *
 * 1. HTTP-level: tenant A creates a cycle; tenant B must not read it by id or
 *    in its list (RLS-backed 404 / empty list), and cannot read A's command
 *    result.
 * 2. Direct, tenant-filter-free: a fixture row is inserted for tenant A into
 *    EVERY one of the 12 movement tables, then a raw query with NO app.tenant_id
 *    GUC returns 0 rows for each (FORCE RLS binds the owner too), and a query
 *    scoped to tenant B returns 0 — proving tenant isolation table by table.
 * 3. Sabotage check on one table: DISABLE RLS leaks the row through the same
 *    raw query, then RLS is restored (inside one transaction so no other
 *    session ever sees it disabled).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { queue } from "../src/shared/infra.js";
import { db, sqlClient } from "../src/shared/db.js";
import { registerMovementConsumers } from "../src/modules/movement/consumer.js";
import * as movement from "../src/modules/movement/schema.js";
import { authHeader, stubCompositionFetch } from "./_helpers.js";

const TENANT_A = "a1a1a1a1-0000-4000-8000-000000000001";
const TENANT_B = "b2b2b2b2-0000-4000-8000-000000000002";
const ACTOR_A = "a1a1a1a1-0000-4000-8000-0000000000aa";
const ACTOR_B = "b2b2b2b2-0000-4000-8000-0000000000bb";

let app: FastifyInstance;
let restoreFetch: () => void;

beforeAll(async () => {
  // Both tenants are entitled, so entitlement never masks an RLS result.
  restoreFetch = stubCompositionFetch(() => ({ configured: true, data: [{ name: "smarttransfer" }] }));
  app = await buildApp();
  await app.ready();
  registerMovementConsumers(queue);
});

afterAll(async () => {
  restoreFetch();
  // Safety net: ensure RLS is on for the sabotaged table before the pool closes.
  const [state] = await sqlClient<{ relforcerowsecurity: boolean }[]>`
    SELECT relforcerowsecurity FROM pg_class WHERE oid = 'smarttransfer.cycles'::regclass
  `;
  if (state && !state.relforcerowsecurity) {
    await sqlClient`ALTER TABLE smarttransfer.cycles ENABLE ROW LEVEL SECURITY`;
    await sqlClient`ALTER TABLE smarttransfer.cycles FORCE ROW LEVEL SECURITY`;
  }
  await app.close();
  await sqlClient.end();
});

describe("HTTP cross-tenant isolation (cycles)", () => {
  let commandId: string;

  it("tenant A creates a cycle", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/smarttransfer/cycles",
      headers: authHeader(TENANT_A, ACTOR_A, ["smarttransfer_admin"]),
      payload: {
        name: "A's cycle",
        movementTypeId: randomUUID(),
        calendar: {
          opensAt: "2026-01-01T00:00:00.000Z",
          freezesAt: "2026-02-01T00:00:00.000Z",
          closesAt: "2026-03-01T00:00:00.000Z",
        },
      },
    });
    expect(res.statusCode).toBe(202);
    commandId = (res.json() as { commandId: string }).commandId;
    await queue.drain();
  });

  it("tenant B's list contains none of tenant A's cycles", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/smarttransfer/cycles",
      headers: authHeader(TENANT_B, ACTOR_B, ["smarttransfer_admin"]),
    });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: Array<{ name: string }> }).data;
    expect(data.find((c) => c.name === "A's cycle")).toBeUndefined();
  });

  it("tenant B cannot read tenant A's command result (FORCE RLS + explicit tenant filter)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/smarttransfer/commands/${commandId}`,
      headers: authHeader(TENANT_B, ACTOR_B, ["smarttransfer_admin"]),
    });
    expect(res.statusCode).toBe(404);
  });
});

// One representative fixture row per movement table (minimal required columns).
const TABLES: Array<{ name: string; table: unknown; fixture: (id: string) => Record<string, unknown> }> = [
  { name: "cycles", table: movement.cycles, fixture: (id) => ({ id, name: "f", status: "draft" }) },
  { name: "requests", table: movement.requests, fixture: (id) => ({ id, cycleId: randomUUID(), employeeId: randomUUID(), status: "draft" }) },
  { name: "preferences", table: movement.preferences, fixture: (id) => ({ id, cycleId: randomUUID(), employeeId: randomUUID(), status: "draft" }) },
  { name: "preferenceItems", table: movement.preferenceItems, fixture: (id) => ({ id, preferenceId: randomUUID(), postId: randomUUID(), rank: 1, status: "active" }) },
  { name: "scenarios", table: movement.scenarios, fixture: (id) => ({ id, cycleId: randomUUID(), name: "s", status: "draft" }) },
  { name: "runs", table: movement.runs, fixture: (id) => ({ id, cycleId: randomUUID(), status: "requested" }) },
  { name: "assignments", table: movement.assignments, fixture: (id) => ({ id, runId: randomUUID(), employeeId: randomUUID(), postId: randomUUID(), status: "proposed" }) },
  { name: "orders", table: movement.orders, fixture: (id) => ({ id, assignmentId: randomUUID(), employeeId: randomUUID(), status: "drafted" }) },
  { name: "relievingRecords", table: movement.relievingRecords, fixture: (id) => ({ id, orderId: randomUUID(), employeeId: randomUUID(), status: "pending" }) },
  { name: "joiningRecords", table: movement.joiningRecords, fixture: (id) => ({ id, orderId: randomUUID(), employeeId: randomUUID(), status: "pending" }) },
  { name: "appeals", table: movement.appeals, fixture: (id) => ({ id, orderId: randomUUID(), employeeId: randomUUID(), status: "submitted" }) },
  { name: "evidence", table: movement.evidence, fixture: (id) => ({ id, runId: randomUUID(), status: "recorded" }) },
];

describe("direct per-table RLS isolation (all 12 movement tables)", () => {
  for (const { name, table, fixture } of TABLES) {
    it(`${name}: a tenant-A row is invisible without the GUC and to tenant B`, async () => {
      const id = randomUUID();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t = table as any;

      await runWithTenant(TENANT_A, () =>
        db.transaction((tx) =>
          tx.insert(t).values({ tenantId: TENANT_A, createdBy: ACTOR_A, updatedBy: ACTOR_A, ...fixture(id) }),
        ),
      );

      // Raw query, NO app.tenant_id GUC: FORCE RLS blocks the owner → 0 rows.
      const noGuc = await sqlClient.unsafe(
        `SELECT id FROM smarttransfer.${tableNameOf(name)} WHERE id = $1`,
        [id],
      );
      expect(noGuc.length).toBe(0);

      // Scoped to tenant B → 0 rows (cross-tenant isolation).
      const asB = await runWithTenant(TENANT_B, () =>
        db.transaction((tx) => tx.select().from(t).where(eq(t.id, id))),
      );
      expect(asB.length).toBe(0);

      // Scoped to tenant A → the row is visible (sanity: RLS is not blanket-denying).
      const asA = await runWithTenant(TENANT_A, () =>
        db.transaction((tx) => tx.select().from(t).where(eq(t.id, id))),
      );
      expect(asA.length).toBe(1);
    });
  }
});

describe("sabotage check (cycles): disabling RLS leaks a row, then RLS is restored", () => {
  it("DISABLE RLS leaks via a raw tenant-filter-free query; ENABLE+FORCE restores isolation", async () => {
    const id = randomUUID();
    await runWithTenant(TENANT_A, () =>
      db.transaction((tx) =>
        tx.insert(movement.cycles).values({ id, tenantId: TENANT_A, name: "sab", status: "draft", createdBy: ACTOR_A, updatedBy: ACTOR_A }),
      ),
    );

    const blocked = await sqlClient`SELECT id FROM smarttransfer.cycles WHERE id = ${id}`;
    expect(blocked.length).toBe(0);

    try {
      await sqlClient.begin(async (sql) => {
        await sql`SET LOCAL lock_timeout = '5s'`;
        await sql`ALTER TABLE smarttransfer.cycles DISABLE ROW LEVEL SECURITY`;
        const leaked = await sql`SELECT id FROM smarttransfer.cycles WHERE id = ${id}`;
        expect(leaked.length).toBe(1);
        await sql`ALTER TABLE smarttransfer.cycles ENABLE ROW LEVEL SECURITY`;
        await sql`ALTER TABLE smarttransfer.cycles FORCE ROW LEVEL SECURITY`;
      });
    } finally {
      await sqlClient`ALTER TABLE smarttransfer.cycles ENABLE ROW LEVEL SECURITY`;
      await sqlClient`ALTER TABLE smarttransfer.cycles FORCE ROW LEVEL SECURITY`;
    }

    const restored = await sqlClient`SELECT id FROM smarttransfer.cycles WHERE id = ${id}`;
    expect(restored.length).toBe(0);
  });
});

// Map the drizzle object key to the physical table name for the raw query.
function tableNameOf(key: string): string {
  const map: Record<string, string> = {
    cycles: "cycles",
    requests: "requests",
    preferences: "preferences",
    preferenceItems: "preference_items",
    scenarios: "scenarios",
    runs: "runs",
    assignments: "assignments",
    orders: "orders",
    relievingRecords: "relieving_records",
    joiningRecords: "joining_records",
    appeals: "appeals",
    evidence: "evidence",
  };
  return map[key] as string;
}
