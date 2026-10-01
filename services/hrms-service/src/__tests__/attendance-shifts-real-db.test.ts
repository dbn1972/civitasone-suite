/**
 * GET /v1/hrms/shifts — grace/working-minutes numeric fields and
 * cross-midnight (night shift) handling (real DB, no mocks).
 *
 * GAP-HR-SHIFTS-02: repo.listShifts used to pre-format breakDuration as
 * `"${graceMins} min grace"` (mislabeling the grace period as a "break")
 * and return "—" for workingHours on any cross-midnight shift (end time
 * numerically before start time). Now returns plain graceMinutes/
 * workingMinutes numbers; the web layer (shifts/page.tsx's mapShifts, which
 * already anticipated exactly this shape) formats them for display.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withTenantScope } from "@civitasone/db";
import { buildApp } from "../app.js";
import { db, sqlClient } from "../shared/db.js";
import { hrmsShifts } from "../modules/attendance/schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const SEED_ACTOR = randomUUID();
const HR_SUB = "shifts-hr";

function auth(sub: string, roles: string[]): { authorization: string } {
  return { authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "sess-shifts-test" }, SECRET, 3600)}` };
}

async function seedShift(name: string, startTime: string, endTime: string, graceMins: number): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsShifts).values({
    id: randomUUID(), tenantId: TENANT, name, startTime, endTime, graceMins,
    createdBy: SEED_ACTOR, updatedBy: SEED_ACTOR,
  }));
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/hrms/shifts", () => {
  it("GAP-HR-SHIFTS-02: a day shift (09:00-17:30) returns graceMinutes/workingMinutes as plain numbers", async () => {
    await seedShift("General Duty", "09:00:00", "17:30:00", 15);
    const r = await app.inject({ method: "GET", url: "/v1/hrms/shifts", headers: auth(HR_SUB, ["hr_admin"]) });
    expect(r.statusCode).toBe(200);
    const row = (r.json().data as Array<Record<string, unknown>>).find((x) => x.name === "General Duty");
    expect(row?.graceMinutes).toBe(15);
    expect(row?.workingMinutes).toBe(510); // 8.5h
    expect(row).not.toHaveProperty("breakDuration");
  });

  it("GAP-HR-SHIFTS-02: a night shift (22:00-06:00) wraps past midnight instead of returning '—'", async () => {
    await seedShift("Night Shift", "22:00:00", "06:00:00", 15);
    const r = await app.inject({ method: "GET", url: "/v1/hrms/shifts", headers: auth(HR_SUB, ["hr_admin"]) });
    const row = (r.json().data as Array<Record<string, unknown>>).find((x) => x.name === "Night Shift");
    expect(row?.workingMinutes).toBe(480); // 22:00 -> 06:00 = 8h, not negative / "—"
  });
});
