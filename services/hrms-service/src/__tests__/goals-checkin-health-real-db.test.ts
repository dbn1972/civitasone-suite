/**
 * POST /v1/hrms/goals/:id/checkin — post-write goal health (real DB, no mocks).
 *
 * GAP-HR-GOALS-04: the check-in response carried only the progress it had just
 * been given, so the goals card guessed "active" (rendered On Track) after a
 * check-in even for a goal that was behind schedule, while the refreshed list
 * (GET /v1/hrms/goals) reported the real derived health. The response now
 * carries `goalStatus` (what was stored) and `health` (the same derivation the
 * list uses), and these tests pin that the two can never disagree.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";
import type { FastifyInstance } from "fastify";

// Set for every hrms-service test run by vitest.config.ts (test.env); no literal here.
const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const ALICE = randomUUID();
const CAROL = randomUUID();

function auth(sub: string, roles: string[] = ["employee"]): { authorization: string } {
  return { authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "sess-goal-health" }, SECRET, 3600)}` };
}

const DAY = 86_400_000;
const isoDay = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

async function seedGoal(opts: { employee: string; status: string; progress?: number; dueInDays: number | null; createdDaysAgo: number }): Promise<string> {
  const id = randomUUID();
  await sqlClient.begin(async (sql) => {
    await sql.unsafe("SELECT set_config('app.tenant_id', $1, true)", [TENANT]);
    await sql.unsafe(
      `INSERT INTO hrms.goals (id, tenant_id, employee_id, title, description, category, key_results, progress, status, due_date, created_at, updated_at)
       VALUES ($1, $2, $3, 'Digitise land records', '', 'individual', '[]', $4, $5, $6, $7, $7)`,
      [id, TENANT, opts.employee, opts.progress ?? 0, opts.status,
        opts.dueInDays === null ? null : isoDay(opts.dueInDays),
        new Date(Date.now() - opts.createdDaysAgo * DAY).toISOString()],
    );
  });
  return id;
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});
afterAll(async () => {
  // Remove everything this file created (check-ins and the completion points
  // first, then the goals), as the sibling real-DB tests do.
  await withRawTenantGuc(sqlClient, TENANT, async (tx) => {
    await tx`DELETE FROM hrms.goal_checkins WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM hrms.leaderboard_points WHERE tenant_id = ${TENANT}`;
    await tx`DELETE FROM hrms.goals WHERE tenant_id = ${TENANT}`;
  });
  await app.close();
  await sqlClient.end();
});

async function checkin(goalId: string, progress: number, sub = ALICE) {
  return app.inject({
    method: "POST", url: `/v1/hrms/goals/${goalId}/checkin`,
    headers: auth(sub), payload: { progress, note: "update" },
  });
}
async function listedHealth(goalId: string): Promise<string | undefined> {
  const r = await app.inject({ method: "GET", url: "/v1/hrms/goals?status=all", headers: auth(ALICE) });
  expect(r.statusCode).toBe(200);
  return (r.json().data as Array<{ id: string; health: string }>).find((g) => g.id === goalId)?.health;
}

describe("POST /v1/hrms/goals/:id/checkin — response carries the real health", () => {
  it("a goal at 20% with its due date 3 days away is Behind, not On Track, and the list agrees", async () => {
    const id = await seedGoal({ employee: ALICE, status: "active", dueInDays: 3, createdDaysAgo: 30 });
    const r = await checkin(id, 20);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ status: "checked_in", progress: 20, goalStatus: "active", health: "behind" });
    expect(await listedHealth(id)).toBe("behind");
  });

  it("a goal on schedule stays On Track after a check-in", async () => {
    const id = await seedGoal({ employee: ALICE, status: "active", dueInDays: 3, createdDaysAgo: 30 });
    const r = await checkin(id, 95);
    expect(r.json()).toMatchObject({ goalStatus: "active", health: "on_track" });
    expect(await listedHealth(id)).toBe("on_track");
  });

  it("a goal with no due date is On Track (nothing to measure against)", async () => {
    const id = await seedGoal({ employee: ALICE, status: "active", dueInDays: null, createdDaysAgo: 30 });
    expect((await checkin(id, 5)).json()).toMatchObject({ goalStatus: "active", health: "on_track" });
  });

  it("100% completes the goal and the response says so", async () => {
    const id = await seedGoal({ employee: ALICE, status: "active", dueInDays: 3, createdDaysAgo: 30 });
    const r = await checkin(id, 100);
    expect(r.json()).toMatchObject({ progress: 100, goalStatus: "completed", health: "completed" });
    expect(await listedHealth(id)).toBe("completed");
  });

  it("someone else's goal is still a 404 (ownership unchanged)", async () => {
    const id = await seedGoal({ employee: ALICE, status: "active", dueInDays: 3, createdDaysAgo: 30 });
    const r = await checkin(id, 10, CAROL);
    expect(r.statusCode).toBe(404);
    expect(r.json().health).toBeUndefined();
  });
});
