/**
 * UAT R2 / F108 (security): an HR officer's approvals inbox listed finance-chain
 * workflow tasks ("Finance Officer Approval") because a task with no roleRef was
 * visible to every role-holder, and the non-pending listing returned every task
 * in the tenant. This pins the server-side scoping (tasks/repo.ts
 * taskVisibilityPredicate) for both the pending inbox and the full listing,
 * including the exact totals, through the query layer and the route.
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
    VALUES (${id}, ${tenant}, 'Visibility fixture', 'active', ${actor}, ${actor})
  `);
  return id;
}

async function seedTask(
  tenant: string, instanceId: string, name: string,
  o: { roleRef: string | null; refType?: string | null; status?: string; assigneeId?: string | null },
): Promise<void> {
  const actor = randomUUID();
  await sqlAsTenant(tenant, sql`
    INSERT INTO workflow.tasks (id, tenant_id, instance_id, name, status, role_ref, ref_type, assignee_id, is_call, created_by, updated_by)
    VALUES (${randomUUID()}, ${tenant}, ${instanceId}, ${name}, ${o.status ?? "pending"}, ${o.roleRef}, ${o.refType ?? null}, ${o.assigneeId ?? null}, false, ${actor}, ${actor})
  `);
}

/** The UAT shape: a leave task for the HR officer's manager role, plus finance-chain tasks. */
async function seedMixedTenant(tenant: string, hrActor: string): Promise<void> {
  const inst = await seedInstance(tenant);
  await seedTask(tenant, inst, "Reporting Officer Approval", { roleRef: "manager", refType: "leave_app" });
  await seedTask(tenant, inst, "Finance Officer Approval", { roleRef: null }); // unrestricted, unassigned
  await seedTask(tenant, inst, "Accounts Check", { roleRef: "finance_accountant" }); // another module's role
  await seedTask(tenant, inst, "Final Approval", { roleRef: "finance_approver", status: "completed" });
  await seedTask(tenant, inst, "Ad-hoc review", { roleRef: null, assigneeId: hrActor }); // unrestricted, assigned to HR
  await seedTask(tenant, inst, "Ad-hoc other", { roleRef: null, assigneeId: randomUUID() }); // unrestricted, someone else
}

const HR_ROLES = ["hr_officer", "manager"];

describe("task list visibility (UAT R2 / F108)", () => {
  it("pending inbox: an HR officer sees their role task and an unrestricted task assigned to them, never finance-chain tasks", async () => {
    const tenant = newTenant();
    const hr = randomUUID();
    await seedMixedTenant(tenant, hr);

    const res = await asTenant(tenant, () => queries.listTasks(tenant, 50, 0, { status: "pending", roles: HR_ROLES, actorId: hr }));
    expect(res.data.map((t) => t.name).sort()).toEqual(["Ad-hoc review", "Reporting Officer Approval"]);
    expect(res.pagination.total).toBe(2);
  });

  it("full listing (no status): an HR officer no longer gets every task in the tenant", async () => {
    const tenant = newTenant();
    const hr = randomUUID();
    await seedMixedTenant(tenant, hr);

    const res = await asTenant(tenant, () => queries.listTasks(tenant, 50, 0, { roles: HR_ROLES, actorId: hr }));
    expect(res.data.map((t) => t.name).sort()).toEqual(["Ad-hoc review", "Reporting Officer Approval"]);
    expect(res.pagination.total).toBe(2);
  });

  it("a finance role-holder sees only tasks for their own role (and none of HR's)", async () => {
    const tenant = newTenant();
    await seedMixedTenant(tenant, randomUUID());
    const res = await asTenant(tenant, () => queries.listTasks(tenant, 50, 0, { status: "pending", roles: ["finance_accountant"], actorId: randomUUID() }));
    expect(res.data.map((t) => t.name)).toEqual(["Accounts Check"]);
  });

  it("workflow_admin keeps triage visibility of unrestricted tasks in the inbox and the whole tenant on the full listing; super_admin sees everything", async () => {
    const tenant = newTenant();
    await seedMixedTenant(tenant, randomUUID());
    const admin = randomUUID();

    const inbox = await asTenant(tenant, () => queries.listTasks(tenant, 50, 0, { status: "pending", roles: ["workflow_admin"], actorId: admin }));
    expect(inbox.data.map((t) => t.name).sort()).toEqual(["Ad-hoc other", "Ad-hoc review", "Finance Officer Approval"]);

    const all = await asTenant(tenant, () => queries.listTasks(tenant, 50, 0, { roles: ["workflow_admin"], actorId: admin }));
    expect(all.pagination.total).toBe(6);

    const sa = await asTenant(tenant, () => queries.listTasks(tenant, 50, 0, { status: "pending", roles: ["super_admin"], actorId: admin }));
    expect(sa.pagination.total).toBe(5);
  });

  it("GET /v1/workflow/tasks: the HR officer token gets no finance task, pending or not", async () => {
    const tenant = newTenant();
    const hr = randomUUID();
    await seedMixedTenant(tenant, hr);
    const token = signToken({ sub: hr, tid: tenant, roles: HR_ROLES, sid: "sess-r2" }, SECRET);

    const app = await buildApp();
    try {
      for (const url of ["/v1/workflow/tasks?status=pending&limit=50", "/v1/workflow/tasks?limit=50"]) {
        const res = await app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });
        expect(res.statusCode).toBe(200);
        const body = res.json() as { data: Array<{ name: string }>; pagination: { total: number } };
        const names = body.data.map((t) => t.name);
        expect(names).not.toContain("Finance Officer Approval");
        expect(names).not.toContain("Accounts Check");
        expect(names).not.toContain("Final Approval");
        expect(names).toContain("Reporting Officer Approval");
        expect(body.pagination.total).toBe(2);
      }
    } finally {
      await app.close();
    }
  });
});
