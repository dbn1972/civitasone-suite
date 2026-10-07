/**
 * Bug fix regression: GET /v1/procurement/dashboard's `grnsThisMonth` used to
 * count every GRN ever created for the tenant (no date filter at all), so the
 * "GRNs (MTD)" stat on the procurement dashboard silently showed the
 * all-time total instead of the current month's count. This seeds one GRN
 * received this month and one received two months ago and asserts only the
 * current-month one is counted.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { procurementGrns } from "../src/modules/grn/schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "9c900000-1111-4000-8000-000000000099";
const ACTOR  = "9c900000-2222-4000-8000-000000000099";
const VENDOR = "9c900000-3333-4000-8000-000000000099";

function tok(roles: string[]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-dash-grn" }, SECRET, 3600);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function seedGrn(id: string, receivedDate: string, status = "accepted"): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(procurementGrns).values({
      id, tenantId: TENANT, grnNo: `GRN-DASH-${id.slice(-4)}`,
      poRef: "procurement_po:seed", vendorId: VENDOR,
      receivedDate, threeWayMatch: false, status,
      createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
}

async function wipe(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(procurementGrns).where(eq(procurementGrns.tenantId, TENANT));
  }));
}

let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); await wipe(); });
afterAll(async () => { await wipe(); await app.close(); await sqlClient.end(); });

describe("GET /v1/procurement/dashboard — grnsThisMonth", () => {
  it("counts only GRNs received in the current calendar month", async () => {
    const now = new Date();
    const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 15);

    await seedGrn(randomUUID(), isoDate(now));
    await seedGrn(randomUUID(), isoDate(twoMonthsAgo));

    const res = await app.inject({
      method: "GET", url: "/v1/procurement/dashboard",
      headers: { authorization: `Bearer ${tok(["procurement_officer"])}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().grnsThisMonth).toBe(1);
  });

  // GAP-PROCUREMENT-DASHBOARD-05: "GRNs (MTD)" is a completed-receipt KPI, so
  // only accepted GRNs count. A draft/under-inspection/rejected GRN received
  // this month must NOT inflate the number.
  it("counts only ACCEPTED GRNs, ignoring non-accepted statuses received this month", async () => {
    await wipe();
    const now = new Date();
    const today = isoDate(now);
    await seedGrn(randomUUID(), today, "accepted");
    await seedGrn(randomUUID(), today, "draft");
    await seedGrn(randomUUID(), today, "under_inspection");
    await seedGrn(randomUUID(), today, "rejected");

    const res = await app.inject({
      method: "GET", url: "/v1/procurement/dashboard",
      headers: { authorization: `Bearer ${tok(["procurement_officer"])}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().grnsThisMonth).toBe(1);
  });

  // GAP-PROCUREMENT-DASHBOARD-05: the month boundary is evaluated in the TENANT
  // timezone (Asia/Kolkata), not the DB session clock (UTC). We assert that
  // the SQL truncates "now" in IST: a GRN whose received_date is the IST
  // calendar-month's first day is counted (it is in this IST month), while one
  // dated the last day of the IST previous month is not. This fails on the old
  // `date_trunc('month', now())` form whenever the DB and IST months differ.
  it("uses the Asia/Kolkata calendar month for the boundary, not the DB session timezone", async () => {
    await wipe();
    // Resolve the IST calendar-month start/end straight from the DB so the test
    // asserts against the same clock the fix uses.
    const boundaryRows = (await db.execute(sql`
      SELECT
        date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date AS "monthStart",
        (date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date - interval '1 day')::date AS "prevMonthLastDay"
    `)) as unknown as Array<{ monthStart: string | Date; prevMonthLastDay: string | Date }>;
    const { monthStart, prevMonthLastDay } = boundaryRows[0];

    const monthStartStr = isoDate(new Date(monthStart));
    const prevLastStr = isoDate(new Date(prevMonthLastDay));

    await seedGrn(randomUUID(), monthStartStr, "accepted");   // in this IST month
    await seedGrn(randomUUID(), prevLastStr, "accepted");     // last day of previous IST month

    const res = await app.inject({
      method: "GET", url: "/v1/procurement/dashboard",
      headers: { authorization: `Bearer ${tok(["procurement_officer"])}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().grnsThisMonth).toBe(1);
  });
});
