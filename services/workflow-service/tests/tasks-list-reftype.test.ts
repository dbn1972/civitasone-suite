/**
 * GAP-HR-LEAVE-APPROVALS-02: the leave approvals panel fetched the first 50
 * pending tasks of EVERY type and filtered to refType 'leave_app' client-side,
 * so when other modules' tasks filled the first page the leave approvals
 * silently vanished (and the panel said "No pending approvals"). The
 * `refType` query param used to be stripped by the route's zod schema.
 *
 * This pins the server-side filter: it is applied in SQL (before the page
 * window), the total/hasMore describe the FILTERED set, and the route accepts
 * the param end-to-end.
 */
import { describe, it, expect, afterEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import * as queries from "../src/modules/tasks/queries.js";
import { sqlAsTenant, asTenant, cleanup } from "./helpers/engine-harness.js";

// Set by this service's vitest config; deliberately no literal fallback here.
const SECRET = process.env.JWT_SECRET as string;

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

/** `ageMinutes` makes ordering deterministic: the larger it is, the OLDER (later in the updated_at DESC list) the task. */
async function seedTask(tenant: string, instanceId: string, refType: string | null, ageMinutes: number): Promise<void> {
  const actor = randomUUID();
  await sqlAsTenant(tenant, sql`
    INSERT INTO workflow.tasks (id, tenant_id, instance_id, name, status, role_ref, ref_type, ref_id, is_call, created_by, updated_by, updated_at)
    VALUES (${randomUUID()}, ${tenant}, ${instanceId}, 'Approve something', 'pending', NULL, ${refType}, ${refType ? randomUUID() : null}, false, ${actor}, ${actor}, now() - make_interval(mins => ${ageMinutes}))
  `);
}

describe("listTasks refType filter (GAP-HR-LEAVE-APPROVALS-02)", () => {
  it("with 60 newer non-leave tasks and 3 older leave tasks, the first page of 50 filtered by leave_app returns the 3 leave tasks", async () => {
    const tenant = newTenant();
    const instanceId = await seedInstance(tenant);
    for (let i = 0; i < 3; i++) await seedTask(tenant, instanceId, "leave_app", 1000 + i); // oldest
    for (let i = 0; i < 60; i++) await seedTask(tenant, instanceId, i % 2 ? "payroll_run" : null, i); // newer, other modules

    const opts = { status: "pending", roles: ["manager"] };

    // Control: unfiltered, the 3 leave tasks sit beyond the first page of 50 — exactly the old bug.
    const unfiltered = await asTenant(tenant, () => queries.listTasks(tenant, 50, 0, opts));
    expect(unfiltered.data).toHaveLength(50);
    expect(unfiltered.data.some((t) => t.refType === "leave_app")).toBe(false);
    expect(unfiltered.pagination.total).toBe(63);

    const filtered = await asTenant(tenant, () => queries.listTasks(tenant, 50, 0, { ...opts, refType: "leave_app" }));
    expect(filtered.data).toHaveLength(3);
    expect(filtered.data.every((t) => t.refType === "leave_app")).toBe(true);
    expect(filtered.pagination.total).toBe(3);
    expect(filtered.pagination.hasMore).toBe(false);
  });

  it("total and hasMore describe the FILTERED set, so a client can page through it", async () => {
    const tenant = newTenant();
    const instanceId = await seedInstance(tenant);
    for (let i = 0; i < 7; i++) await seedTask(tenant, instanceId, "leave_app", i);
    for (let i = 0; i < 20; i++) await seedTask(tenant, instanceId, "procurement_po", i);

    const opts = { status: "pending", roles: ["manager"], refType: "leave_app" };
    const page1 = await asTenant(tenant, () => queries.listTasks(tenant, 5, 0, opts));
    expect(page1.data).toHaveLength(5);
    expect(page1.pagination).toMatchObject({ total: 7, hasMore: true, cursor: "5" });
    const page2 = await asTenant(tenant, () => queries.listTasks(tenant, 5, 5, opts));
    expect(page2.data).toHaveLength(2);
    expect(page2.pagination).toMatchObject({ total: 7, hasMore: false });
  });

  it("applies to the non-pending (tenant) listing too, and a different refType is cached separately", async () => {
    const tenant = newTenant();
    const instanceId = await seedInstance(tenant);
    await seedTask(tenant, instanceId, "leave_app", 1);
    await seedTask(tenant, instanceId, "payroll_run", 2);

    const leave = await asTenant(tenant, () => queries.listTasks(tenant, 50, 0, { refType: "leave_app" }));
    const payroll = await asTenant(tenant, () => queries.listTasks(tenant, 50, 0, { refType: "payroll_run" }));
    expect(leave.data.map((t) => t.refType)).toEqual(["leave_app"]);
    expect(payroll.data.map((t) => t.refType)).toEqual(["payroll_run"]);
  });
});

describe("GET /v1/workflow/tasks?refType= (route)", () => {
  it("accepts refType and returns only that type's tasks with the filtered total", async () => {
    const tenant = newTenant();
    const instanceId = await seedInstance(tenant);
    for (let i = 0; i < 2; i++) await seedTask(tenant, instanceId, "leave_app", 500 + i);
    for (let i = 0; i < 55; i++) await seedTask(tenant, instanceId, "payroll_run", i);
    const token = signToken({ sub: randomUUID(), tid: tenant, roles: ["manager"], sid: "sess-reftype" }, SECRET);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "GET",
        url: "/v1/workflow/tasks?status=pending&limit=50&refType=leave_app",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: Array<{ refType: string }>; pagination: { total: number; hasMore: boolean } };
      expect(body.data).toHaveLength(2);
      expect(body.data.every((t) => t.refType === "leave_app")).toBe(true);
      expect(body.pagination.total).toBe(2);
      expect(body.pagination.hasMore).toBe(false);

      const tooLong = await app.inject({
        method: "GET",
        url: `/v1/workflow/tasks?refType=${"x".repeat(65)}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(tooLong.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});
