/**
 * UAT J14 follow-up (bundle 15, security, low): GET /v1/workflow/tasks/:id/forwards answered
 * 200 with the forward chain (who forwarded the task to whom, with remarks) to any workflow
 * role-holder, participant or not, while every other per-instance read was gated in #2445.
 * It now applies the same participant gate as the instance reads (canViewInstance: requester,
 * or holder / assignee / completer of one of its tasks) plus the parties of the forward chain
 * itself; super_admin / workflow_admin are exempt. A non-participant gets 404, the same answer
 * as for a task that does not exist, so the read does not reveal that the task exists.
 */
import { describe, it, expect, afterEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { sqlAsTenant, cleanup } from "./helpers/engine-harness.js";

const SECRET = process.env.JWT_SECRET as string;
const tenants: string[] = [];
function newTenant(): string { const t = randomUUID(); tenants.push(t); return t; }
afterEach(async () => {
  for (const t of tenants) await sqlAsTenant(t, sql`DELETE FROM workflow.task_forwards WHERE tenant_id = ${t}`);
  if (tenants.length) { await cleanup(...tenants); tenants.length = 0; }
});
afterAll(async () => { await sqlClient.end(); });

const auth = (tenant: string, roles: string[], sub = randomUUID()) =>
  ({ authorization: `Bearer ${signToken({ sub, tid: tenant, roles, sid: "s-fwd" }, SECRET)}` });

type Fixture = { tenant: string; inst: string; task: string; submitter: string; assignee: string; forwarder: string };

/** One instance with a manager task assigned to `assignee`, forwarded to them by `forwarder`. */
async function seed(): Promise<Fixture> {
  const tenant = newTenant();
  const inst = randomUUID(), task = randomUUID();
  const submitter = randomUUID(), assignee = randomUUID(), forwarder = randomUUID();
  await sqlAsTenant(tenant, sql`
    INSERT INTO workflow.instances (id, tenant_id, name, status, created_by, updated_by)
    VALUES (${inst}, ${tenant}, ${"Leave Approval"}, ${"active"}, ${submitter}, ${submitter})`);
  await sqlAsTenant(tenant, sql`
    INSERT INTO workflow.tasks (id, tenant_id, instance_id, name, status, role_ref, assignee_id, is_call, created_by, updated_by)
    VALUES (${task}, ${tenant}, ${inst}, ${"Reporting Officer Approval"}, ${"pending"}, ${"manager"}, ${assignee}, false, ${submitter}, ${submitter})`);
  await sqlAsTenant(tenant, sql`
    INSERT INTO workflow.task_forwards (id, tenant_id, task_id, instance_id, from_user, to_user, remarks, action)
    VALUES (${randomUUID()}, ${tenant}, ${task}, ${inst}, ${forwarder}, ${assignee}, ${"Please examine"}, ${"forward"})`);
  return { tenant, inst, task, submitter, assignee, forwarder };
}

async function withApp<T>(fn: (app: FastifyInstance) => Promise<T>): Promise<T> {
  const app = await buildApp();
  try { return await fn(app); } finally { await app.close(); }
}

const get = (app: FastifyInstance, task: string, headers: Record<string, string>) =>
  app.inject({ method: "GET", url: `/v1/workflow/tasks/${task}/forwards`, headers });

describe("GET /v1/workflow/tasks/:id/forwards is for participants only", () => {
  it("a non-participant role-holder gets 404 and no forward data", async () => {
    const f = await seed();
    await withApp(async (app) => {
      for (const roles of [["workflow_user"], ["hr_admin", "workflow_user"], ["estab_officer"]]) {
        const res = await get(app, f.task, auth(f.tenant, roles));
        expect(res.statusCode, roles.join(",")).toBe(404);
        expect(res.body).not.toContain("Please examine");
        expect(res.body).not.toContain(f.forwarder);
      }
    });
  });

  it("a non-participant gets the same 404 for an existing task and for a task that does not exist", async () => {
    const f = await seed();
    await withApp(async (app) => {
      const h = auth(f.tenant, ["workflow_user"]);
      const existing = await get(app, f.task, h);
      const missing = await get(app, randomUUID(), h);
      expect(existing.statusCode).toBe(404);
      expect(missing.statusCode).toBe(404);
      expect(existing.json().code).toBe(missing.json().code);
    });
  });

  it("a task of another tenant is 404 even for a participant identity", async () => {
    const f = await seed();
    const other = newTenant();
    await withApp(async (app) => {
      const res = await get(app, f.task, auth(other, ["workflow_user", "manager"], f.assignee));
      expect(res.statusCode).toBe(404);
    });
  });

  it("participants (assignee, role holder, requester, the forwarder) get 200 with the chain", async () => {
    const f = await seed();
    await withApp(async (app) => {
      const callers: Array<[string, Record<string, string>]> = [
        ["assignee", auth(f.tenant, ["workflow_user"], f.assignee)],
        ["role holder", auth(f.tenant, ["workflow_user", "manager"])],
        ["requester", auth(f.tenant, ["workflow_user"], f.submitter)],
        ["forwarder", auth(f.tenant, ["workflow_user"], f.forwarder)],
      ];
      for (const [who, h] of callers) {
        const res = await get(app, f.task, h);
        expect(res.statusCode, who).toBe(200);
        const data = (res.json() as { data: Array<{ fromUser: string; toUser: string; remarks: string }> }).data;
        expect(data, who).toHaveLength(1);
        expect(data[0]!.fromUser).toBe(f.forwarder);
        expect(data[0]!.toUser).toBe(f.assignee);
      }
    });
  });

  it("super_admin and workflow_admin get 200 without being participants", async () => {
    const f = await seed();
    await withApp(async (app) => {
      for (const roles of [["super_admin"], ["workflow_admin"]]) {
        const res = await get(app, f.task, auth(f.tenant, roles));
        expect(res.statusCode, roles[0]).toBe(200);
        expect((res.json() as { data: unknown[] }).data).toHaveLength(1);
      }
    });
  });
});
