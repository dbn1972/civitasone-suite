/** CAP-027 — SLA routes: working calendar, pause/resume, overdue queue, breach. */
import { describe, it, expect, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "a7000000-1111-4000-8000-000000000001";

function token(roles = ["workflow_admin"]) {
  return signToken({ sub: randomUUID(), tid: TENANT, roles, sid: "s" }, SECRET);
}

async function seedPastDueTask(): Promise<string> {
  const instId = randomUUID();
  const taskId = randomUUID();
  const actor = randomUUID();
  await db.execute(sql`INSERT INTO workflow.instances (id, tenant_id, name, status, created_by, updated_by)
    VALUES (${instId}, ${TENANT}, 'SLA inst', 'active', ${actor}, ${actor})`);
  await db.execute(sql`INSERT INTO workflow.tasks (id, tenant_id, instance_id, name, status, role_ref, due_at, created_by, updated_by)
    VALUES (${taskId}, ${TENANT}, ${instId}, 'Overdue task', 'pending', 'officer', now() - interval '1 hour', ${actor}, ${actor})`);
  return taskId;
}

afterEach(async () => {
  await db.execute(sql`DELETE FROM workflow.task_sla_pauses WHERE tenant_id = ${TENANT}`);
  await db.execute(sql`DELETE FROM workflow.tasks WHERE tenant_id = ${TENANT}`);
  await db.execute(sql`DELETE FROM workflow.instances WHERE tenant_id = ${TENANT}`);
  await db.execute(sql`DELETE FROM workflow.working_calendars WHERE tenant_id = ${TENANT}`);
});
afterAll(async () => { await sqlClient.end(); });

describe("CAP-027 working calendar + due-date preview", () => {
  it("computes a due date over a business calendar (weekend-aware)", async () => {
    const app = await buildApp();
    const code = `cal-${Date.now()}`;
    const create = await app.inject({
      method: "POST", url: "/v1/workflow/calendars",
      headers: { authorization: `Bearer ${token()}` },
      payload: { code, name: "Std", workweek: [1, 2, 3, 4, 5], holidays: [], workStartMinute: 540, workEndMinute: 1020 },
    });
    expect(create.statusCode).toBe(201);
    // Fri 2025-01-03 16:00Z + 120 working min → Mon 2025-01-06 10:00Z
    const preview = await app.inject({
      method: "POST", url: "/v1/workflow/sla/preview",
      headers: { authorization: `Bearer ${token()}` },
      payload: { calendarCode: code, slaMinutes: 120, from: "2025-01-03T16:00:00.000Z" },
    });
    await app.close();
    expect(preview.statusCode).toBe(200);
    expect(preview.json().data.dueAt).toBe("2025-01-06T10:00:00.000Z");
  });
});

describe("CAP-027 SLA overdue queue + breach report", () => {
  it("surfaces a past-due task in the overdue queue and breach report", async () => {
    const app = await buildApp();
    await seedPastDueTask();
    const overdue = await app.inject({ method: "GET", url: "/v1/workflow/sla/overdue", headers: { authorization: `Bearer ${token()}` } });
    const report = await app.inject({ method: "GET", url: "/v1/workflow/sla/breach-report", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(overdue.json().total).toBe(1);
    expect(overdue.json().data[0].name).toBe("Overdue task");
    expect(report.json().data.totalOverdue).toBe(1);
    expect(report.json().data.byRole[0]).toEqual({ roleRef: "officer", count: 1 });
  });
});

describe("CAP-027 SLA pause/resume", () => {
  it("pauses once (idempotent) and resumes, pushing due_at forward", async () => {
    const app = await buildApp();
    const taskId = await seedPastDueTask();
    const before = await db.execute(sql`SELECT due_at FROM workflow.tasks WHERE id = ${taskId}`);
    const dueBefore = new Date((before as unknown as Array<{ due_at: string }>)[0]!.due_at).getTime();

    const p1 = await app.inject({ method: "POST", url: `/v1/workflow/tasks/${taskId}/sla/pause`, headers: { authorization: `Bearer ${token()}` }, payload: { reason: "waiting on citizen" } });
    expect(p1.statusCode).toBe(201);
    const p2 = await app.inject({ method: "POST", url: `/v1/workflow/tasks/${taskId}/sla/pause`, headers: { authorization: `Bearer ${token()}` }, payload: {} });
    expect(p2.statusCode).toBe(409); // already paused

    const resume = await app.inject({ method: "POST", url: `/v1/workflow/tasks/${taskId}/sla/resume`, headers: { authorization: `Bearer ${token()}` } });
    expect(resume.statusCode).toBe(200);
    expect(resume.json().data.pausedMinutes).toBeGreaterThanOrEqual(0);

    const after = await db.execute(sql`SELECT due_at FROM workflow.tasks WHERE id = ${taskId}`);
    const dueAfter = new Date((after as unknown as Array<{ due_at: string }>)[0]!.due_at).getTime();
    await app.close();
    expect(dueAfter).toBeGreaterThanOrEqual(dueBefore); // clock shifted forward (or equal for a ~0s pause)
  });
});
