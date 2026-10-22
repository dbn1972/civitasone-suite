/**
 * GAP-HR-ONBOARDING-DETAIL-06 -- real-DB regression: the tenant-wide onboarding
 * summary (GET /v1/hrms/onboarding) decides "overdue" against the IST calendar
 * date, matching the detail page, not the UTC date.
 *
 * Bug: the route compared a task's due date (joining + dueByDay) against
 * `new Date().toISOString().slice(0, 10)` -- the UTC date -- which is still the
 * previous day between 00:00 and 05:30 IST. For those 5.5 hours the list's
 * overdue count disagreed with the detail page (which already used IST).
 *
 * Only Date is faked (timers stay real), so the real Postgres round-trips run
 * normally; the JWT is signed AFTER the clock is set so its iat/exp are valid
 * relative to the faked "now".
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withTenantScope } from "@civitasone/db";
import { buildApp } from "../app.js";
import { db, sqlClient } from "../shared/db.js";
import { hrmsEmployees } from "../modules/employee/schema.js";
import { hrmsOnboardingTasks } from "../modules/lifecycle/schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET as string; // set by this service vitest.config.ts
const TENANT = randomUUID();
const HR_ACTOR = randomUUID();

let app: FastifyInstance;
let empId: string;

function hrHeaders(): { authorization: string } {
  const jwt = signToken({ sub: HR_ACTOR, tid: TENANT, roles: ["hr_admin"], sid: "sess-onb-ist" }, SECRET, 3600);
  return { authorization: `Bearer ${jwt}` };
}

beforeAll(async () => {
  app = await buildApp();
  empId = randomUUID();
  // Joined 2026-03-01; a single pending task due on day 1 => due date 2026-03-02.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, async (tx: any) => {
    await tx.insert(hrmsEmployees).values({
      id: empId, tenantId: TENANT, employeeNo: `ONB-${empId.slice(0, 8)}`, fullName: "Ishaan Boundary",
      departmentId: randomUUID(), designationId: randomUUID(), dateOfJoining: "2026-03-01",
      createdBy: HR_ACTOR, updatedBy: HR_ACTOR,
    });
    await tx.insert(hrmsOnboardingTasks).values({
      tenantId: TENANT, employeeId: empId, title: "Collect ID proof", dueByDay: 1, status: "pending", createdBy: HR_ACTOR,
    });
  });
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

async function overdueFor(nowIso: string): Promise<{ status: string; overdue: number }> {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(nowIso));
  const r = await app.inject({ method: "GET", url: "/v1/hrms/onboarding?status=all", headers: hrHeaders() });
  expect(r.statusCode).toBe(200);
  const rows = JSON.parse(r.body).data as Array<{ id: string; status: string; overdue: number }>;
  const row = rows.find((x) => x.id === empId);
  expect(row).toBeDefined();
  return { status: row!.status, overdue: row!.overdue };
}

describe("GET /v1/hrms/onboarding overdue uses the IST calendar date", () => {
  it("is NOT overdue on the due date itself, even at 23:59 IST (18:29 UTC)", async () => {
    // 2026-03-02T18:29:00Z == 23:59 IST on 2 March (the due date).
    const r = await overdueFor("2026-03-02T18:29:00Z");
    expect(r).toEqual({ status: "in_progress", overdue: 0 });
  });

  it("flips to overdue at 00:10 IST the next day, while the UTC date is still the due date", async () => {
    // 2026-03-02T18:40:00Z == 00:10 IST on 3 March. UTC date is still 2026-03-02
    // (== the due date), so the old UTC comparison said NOT overdue here.
    const r = await overdueFor("2026-03-02T18:40:00Z");
    expect(r).toEqual({ status: "overdue", overdue: 1 });
  });
});
