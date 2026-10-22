/**
 * GAP-PROCUREMENT-APPROVALS-01: the procurement approvals queue asked for
 * /v1/workflow/tasks?status=pending&limit=N across ALL modules and filtered to
 * its four refTypes client-side. The route's query schema had no `refType`
 * (zod strips unknown keys), so the filter was never applied server-side and a
 * procurement task past the first N tenant-wide pending tasks never rendered.
 *
 * This pins, against the real DB:
 *   - ?refType=... (repeated, or a single value) narrows the role-scoped pending
 *     inbox in SQL BEFORE limit/offset, so tasks the unfiltered first page cuts
 *     off are returned;
 *   - pagination.total / hasMore describe the FILTERED set, so a client can page
 *     until exhausted;
 *   - narrowing never widens the role scope (a task for another role stays hidden);
 *   - the cache key carries the refType set and the caller's role set, so a
 *     filtered page is never served for an unfiltered request and one role's
 *     cached inbox is never served to a caller holding different roles.
 */
import { describe, it, expect, afterEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import * as queries from "../src/modules/tasks/queries.js";
import { sqlAsTenant, asTenant, cleanup } from "./helpers/engine-harness.js";

const SECRET = process.env.JWT_SECRET as string;
// The four refTypes the procurement approvals queue asks for. Only the first two can be SEEDED:
// workflow.tasks has a ref_type CHECK (migration 0024) that currently rejects procurement_plan and
// procurement_po_amendment, so the filter is exercised with rows of the two accepted types while
// the request still names all four.
const PROCUREMENT_REF_TYPES = ["procurement_indent", "procurement_po", "procurement_plan", "procurement_po_amendment"];

const tenants: string[] = [];
function newTenant(): string { const t = randomUUID(); tenants.push(t); return t; }

afterEach(async () => { if (tenants.length) { await cleanup(...tenants); tenants.length = 0; } });
afterAll(async () => { await sqlClient.end(); });

async function seedInstance(tenant: string): Promise<string> {
  const id = randomUUID();
  const actor = randomUUID();
  await sqlAsTenant(tenant, sql`
    INSERT INTO workflow.instances (id, tenant_id, name, status, created_by, updated_by)
    VALUES (${id}, ${tenant}, 'Queue fixture', 'active', ${actor}, ${actor})
  `);
  return id;
}

/**
 * Bulk-seed `count` pending tasks. `ageSeconds` shifts updated_at into the past,
 * so tasks with a larger age sort LATER in the (updated_at DESC) inbox order.
 */
async function seedTasks(
  tenant: string,
  instanceId: string,
  count: number,
  opts: { refType: string | null; roleRef?: string | null; status?: string; isCall?: boolean; ageSeconds: number },
): Promise<void> {
  const actor = randomUUID();
  await sqlAsTenant(tenant, sql`
    INSERT INTO workflow.tasks (id, tenant_id, instance_id, name, status, role_ref, ref_type, ref_id, is_call, created_by, updated_by, updated_at)
    SELECT gen_random_uuid(), ${tenant}::uuid, ${instanceId}::uuid, 'Approve ' || g, ${opts.status ?? "pending"}::varchar, ${opts.roleRef ?? null}::varchar,
           ${opts.refType}::varchar, gen_random_uuid(), ${opts.isCall ?? false}::boolean, ${actor}::uuid, ${actor}::uuid,
           now() - make_interval(secs => (${opts.ageSeconds}::int + g))
    FROM generate_series(1, ${count}::int) AS g
  `);
}

const pendingAs = (roles: string[]) => ({ status: "pending", roles });

describe("listTasks refType narrowing (GAP-PROCUREMENT-APPROVALS-01)", () => {
  it("returns procurement tasks that sit past the first 50 tenant-wide pending tasks (positions 55-60)", async () => {
    const tenant = newTenant();
    const inst = await seedInstance(tenant);
    // 54 newer non-procurement tasks, then 6 older procurement tasks => the
    // procurement tasks are exactly positions 55-60 of the unfiltered inbox.
    await seedTasks(tenant, inst, 54, { refType: "leave_app", ageSeconds: 0 });
    await seedTasks(tenant, inst, 6, { refType: "procurement_indent", ageSeconds: 10_000 });

    const unfiltered = await asTenant(tenant, () => queries.listTasks(tenant, 50, 0, pendingAs(["manager"])));
    expect(unfiltered.data).toHaveLength(50);
    expect(unfiltered.data.some((t) => t.refType === "procurement_indent")).toBe(false); // the original defect
    expect(unfiltered.pagination.total).toBe(60);

    const filtered = await asTenant(tenant, () =>
      queries.listTasks(tenant, 50, 0, { ...pendingAs(["manager"]), refTypes: PROCUREMENT_REF_TYPES }));
    expect(filtered.data).toHaveLength(6);
    expect(filtered.data.every((t) => t.refType === "procurement_indent")).toBe(true);
    expect(filtered.pagination.total).toBe(6);
    expect(filtered.pagination.hasMore).toBe(false);
  });

  it("keeps the requested procurement refTypes and excludes other refTypes, non-pending, call and other-role tasks", async () => {
    const tenant = newTenant();
    const inst = await seedInstance(tenant);
    for (const rt of ["procurement_indent", "procurement_po"]) await seedTasks(tenant, inst, 1, { refType: rt, ageSeconds: 5 });
    await seedTasks(tenant, inst, 3, { refType: "leave_app", ageSeconds: 5 });
    await seedTasks(tenant, inst, 2, { refType: "procurement_po", status: "completed", ageSeconds: 5 });
    await seedTasks(tenant, inst, 2, { refType: "procurement_po", isCall: true, ageSeconds: 5 });
    await seedTasks(tenant, inst, 2, { refType: "procurement_po", roleRef: "payroll_admin", ageSeconds: 5 });

    const res = await asTenant(tenant, () =>
      queries.listTasks(tenant, 50, 0, { ...pendingAs(["manager"]), refTypes: PROCUREMENT_REF_TYPES }));
    expect(res.data.map((t) => t.refType).sort()).toEqual(["procurement_indent", "procurement_po"]);
    expect(res.pagination.total).toBe(2);

    // Narrowing never widens: the payroll_admin-only tasks appear only for that role.
    const asPayroll = await asTenant(tenant, () =>
      queries.listTasks(tenant, 50, 0, { ...pendingAs(["payroll_admin"]), refTypes: ["procurement_po"] }));
    expect(asPayroll.data).toHaveLength(2 + 1); // 2 payroll-only + the 1 unrestricted procurement_po task
    expect(asPayroll.pagination.total).toBe(3);
  });

  it("pages through the filtered set until exhausted (total/hasMore describe the filtered set)", async () => {
    const tenant = newTenant();
    const inst = await seedInstance(tenant);
    await seedTasks(tenant, inst, 30, { refType: "leave_app", ageSeconds: 0 });
    await seedTasks(tenant, inst, 7, { refType: "procurement_po", ageSeconds: 10_000 });
    const opts = { ...pendingAs(["manager"]), refTypes: ["procurement_po"] };

    const p1 = await asTenant(tenant, () => queries.listTasks(tenant, 3, 0, opts));
    expect(p1.data).toHaveLength(3);
    expect(p1.pagination).toMatchObject({ total: 7, hasMore: true, cursor: "3" });
    const p2 = await asTenant(tenant, () => queries.listTasks(tenant, 3, 3, opts));
    expect(p2.data).toHaveLength(3);
    expect(p2.pagination.hasMore).toBe(true);
    const p3 = await asTenant(tenant, () => queries.listTasks(tenant, 3, 6, opts));
    expect(p3.data).toHaveLength(1);
    expect(p3.pagination).toMatchObject({ total: 7, hasMore: false });
    const ids = new Set([...p1.data, ...p2.data, ...p3.data].map((t) => t.id));
    expect(ids.size).toBe(7);
  });

  it("does not serve a cached unfiltered page for a filtered request (refType is part of the cache key)", async () => {
    const tenant = newTenant();
    const inst = await seedInstance(tenant);
    await seedTasks(tenant, inst, 5, { refType: "leave_app", ageSeconds: 0 });
    await seedTasks(tenant, inst, 2, { refType: "procurement_po", ageSeconds: 1_000 });

    const unfiltered = await asTenant(tenant, () => queries.listTasks(tenant, 50, 0, pendingAs(["manager"])));
    expect(unfiltered.data).toHaveLength(7); // warms the cache for this tenant/limit/offset
    const filtered = await asTenant(tenant, () =>
      queries.listTasks(tenant, 50, 0, { ...pendingAs(["manager"]), refTypes: ["procurement_po"] }));
    expect(filtered.data).toHaveLength(2);
  });

  it("does not serve one role set's cached inbox to a caller holding different roles", async () => {
    const tenant = newTenant();
    const inst = await seedInstance(tenant);
    await seedTasks(tenant, inst, 2, { refType: "procurement_po", roleRef: "procurement_admin", ageSeconds: 5 });
    await seedTasks(tenant, inst, 1, { refType: "procurement_po", roleRef: "payroll_admin", ageSeconds: 5 });

    const asProcurement = await asTenant(tenant, () => queries.listTasks(tenant, 50, 0, pendingAs(["procurement_admin"])));
    expect(asProcurement.data).toHaveLength(2);
    // Same tenant, status, limit and offset -- only the caller's roles differ.
    const asPayroll = await asTenant(tenant, () => queries.listTasks(tenant, 50, 0, pendingAs(["payroll_admin"])));
    expect(asPayroll.data).toHaveLength(1);
    expect(asPayroll.data[0]!.roleRef).toBe("payroll_admin");
  });
});

describe("GET /v1/workflow/tasks?refType= (route)", () => {
  it("honours repeated and single refType params, and ignores no param (unfiltered stays unchanged)", async () => {
    const tenant = newTenant();
    const inst = await seedInstance(tenant);
    await seedTasks(tenant, inst, 4, { refType: "leave_app", ageSeconds: 0 });
    await seedTasks(tenant, inst, 2, { refType: "procurement_indent", ageSeconds: 1_000 });
    await seedTasks(tenant, inst, 1, { refType: "procurement_po", ageSeconds: 2_000 });
    const app = await buildApp();
    const auth = signToken({ sub: randomUUID(), tid: tenant, roles: ["procurement_admin"], sid: "sess-reftype" }, SECRET, 3600);
    try {
      const get = async (qs: string) => {
        const res = await app.inject({ method: "GET", url: `/v1/workflow/tasks?${qs}`, headers: { authorization: `Bearer ${auth}` } });
        expect(res.statusCode).toBe(200);
        return res.json() as { data: Array<{ refType: string }>; pagination: { total: number; hasMore: boolean } };
      };

      const none = await get("status=pending&limit=50");
      expect(none.data).toHaveLength(7);

      const repeated = await get("status=pending&limit=50&refType=procurement_indent&refType=procurement_po");
      expect(repeated.data.map((t) => t.refType).sort()).toEqual(["procurement_indent", "procurement_indent", "procurement_po"]);
      expect(repeated.pagination.total).toBe(3);

      const single = await get("status=pending&limit=50&refType=procurement_po");
      expect(single.data).toHaveLength(1);

      const unknown = await get("status=pending&limit=50&refType=does_not_exist");
      expect(unknown.data).toHaveLength(0);
      expect(unknown.pagination).toMatchObject({ total: 0, hasMore: false });

      // The server pages the filtered set: offset past the first page is honoured.
      const page2 = await get("status=pending&limit=1&offset=1&refType=procurement_indent&refType=procurement_po");
      expect(page2.data).toHaveLength(1);
      expect(page2.pagination).toMatchObject({ total: 3, hasMore: true });
    } finally {
      await app.close();
    }
  });
});
