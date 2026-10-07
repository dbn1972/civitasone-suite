/**
 * GAP-APPROVALS-HOME-01: the unified approvals inbox used to show only the
 * first page's length as its Pending count and could not reach tasks beyond
 * the first page, because the task-list endpoint returned no total — only
 * `hasMore` (derived from `rows.length === limit`, which is also wrong when the
 * last page exactly fills the limit).
 *
 * This pins the new behaviour of queries.listTasks:
 *   - pagination.total is the EXACT count of the whole matching set
 *     (role-scoped pending inbox), independent of limit/offset;
 *   - hasMore is true iff there are rows beyond the current window;
 *   - a later page is reachable and returns the remaining rows.
 */
import { describe, it, expect, afterEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { sqlClient } from "../src/shared/db.js";
import * as queries from "../src/modules/tasks/queries.js";
import { sqlAsTenant, asTenant, cleanup } from "./helpers/engine-harness.js";

const tenants: string[] = [];
function newTenant(): string { const t = randomUUID(); tenants.push(t); return t; }

afterEach(async () => { if (tenants.length) { await cleanup(...tenants); tenants.length = 0; } });
afterAll(async () => { await sqlClient.end(); });

async function seedInstance(tenant: string): Promise<string> {
  const id = randomUUID();
  const actor = randomUUID();
  await sqlAsTenant(tenant, sql`
    INSERT INTO workflow.instances (id, tenant_id, name, status, created_by, updated_by)
    VALUES (${id}, ${tenant}, 'Inbox fixture', 'active', ${actor}, ${actor})
  `);
  return id;
}

async function seedTask(
  tenant: string,
  instanceId: string,
  opts: { status?: string; roleRef?: string | null; isCall?: boolean } = {},
): Promise<void> {
  const id = randomUUID();
  const actor = randomUUID();
  const status = opts.status ?? "pending";
  const roleRef = opts.roleRef ?? null;
  const isCall = opts.isCall ?? false;
  await sqlAsTenant(tenant, sql`
    INSERT INTO workflow.tasks (id, tenant_id, instance_id, name, status, role_ref, is_call, created_by, updated_by)
    VALUES (${id}, ${tenant}, ${instanceId}, 'Approve something', ${status}, ${roleRef}, ${isCall}, ${actor}, ${actor})
  `);
}

describe("listTasks pagination.total (GAP-APPROVALS-HOME-01)", () => {
  it("reports the exact total of a role-holder's pending inbox and makes a later page reachable", async () => {
    const tenant = newTenant();
    const instanceId = await seedInstance(tenant);
    // 40 pending tasks visible to the manager role (unrestricted roleRef=null).
    for (let i = 0; i < 40; i++) await seedTask(tenant, instanceId, { roleRef: null });
    // Noise that must NOT be counted in the pending-for-roles total:
    await seedTask(tenant, instanceId, { status: "completed", roleRef: null }); // not pending
    await seedTask(tenant, instanceId, { status: "pending", roleRef: null, isCall: true }); // call task
    await seedTask(tenant, instanceId, { status: "pending", roleRef: "payroll_admin" }); // other role

    const opts = { status: "pending", roles: ["manager"] };

    // Page 1, size 15 — the old inbox default. Total must be the full 40,
    // not the 15 rows returned.
    const page1 = await asTenant(tenant, () => queries.listTasks(tenant, 15, 0, opts));
    expect(page1.data.length).toBe(15);
    expect(page1.pagination.total).toBe(40);
    expect(page1.pagination.hasMore).toBe(true);

    // Page 3 (offset 30) is reachable and returns the remaining 10 rows.
    const page3 = await asTenant(tenant, () => queries.listTasks(tenant, 15, 30, opts));
    expect(page3.data.length).toBe(10);
    expect(page3.pagination.total).toBe(40);
    expect(page3.pagination.hasMore).toBe(false);
  });

  it("hasMore is false when the last page exactly fills the limit", async () => {
    const tenant = newTenant();
    const instanceId = await seedInstance(tenant);
    for (let i = 0; i < 30; i++) await seedTask(tenant, instanceId, { roleRef: null });

    const opts = { status: "pending", roles: ["manager"] };
    // Second page of 15 is the last page and is exactly full — the old
    // `rows.length === limit` heuristic wrongly reported hasMore=true here.
    const page2 = await asTenant(tenant, () => queries.listTasks(tenant, 15, 15, opts));
    expect(page2.data.length).toBe(15);
    expect(page2.pagination.total).toBe(30);
    expect(page2.pagination.hasMore).toBe(false);
  });
});
