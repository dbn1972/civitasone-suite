/**
 * UAT b23 P2 (journey J3): a leave row with to_date < from_date (pre-validation data) is invisible to the
 * range-overlap test, yet shares (tenant, employee, from_date, type, day_part) with a new application,
 * so ux_leave_apps_active rejected the INSERT in the async consumer (DLQ) after the user saw "submitted".
 * The shared clash predicate must now report it, synchronously, for the route pre-check and the consumer.
 * Real Postgres; seeds written under the tenant context (RLS in force).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withTenantScope, runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../shared/db.js";
import { hrmsEmployees } from "../modules/employee/schema.js";
import { hrmsLeaveTypes, hrmsLeaveAllocs, hrmsLeaveApps } from "../modules/leave/schema.js";
import { findOverlappingLeaveApps as findInScope } from "../modules/leave/repo.js";

// scopedRead needs the request tenant context; the arg is the tenant the CALLER is signed in as.
const findOverlappingLeaveApps = (tenant: string, ...a: Parameters<typeof findInScope> extends [string, ...infer R] ? R : never) =>
  runWithTenant(tenant, () => findInScope(tenant, ...a));

const TENANT = randomUUID();
const HR = randomUUID();
const EMP = randomUUID();
const OTHER_EMP = randomUUID();
const TYPE = randomUUID();
const ALLOC = randomUUID();
const INVERTED = randomUUID();
const NORMAL = randomUUID();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const scoped = <T>(fn: (tx: any) => Promise<T>) => withTenantScope(db, TENANT, fn);

beforeAll(async () => {
  await scoped(async (tx) => {
    for (const [id, no, name] of [[EMP, "NIC-2217", "Sunita Verma"], [OTHER_EMP, "NIC-2218", "Rajesh Kulkarni"]] as const) {
      await tx.insert(hrmsEmployees).values({
        id, tenantId: TENANT, employeeNo: no, fullName: name, departmentId: randomUUID(), designationId: randomUUID(),
        dateOfJoining: "2018-04-02", userRef: `sub-${no}`, createdBy: HR, updatedBy: HR,
      });
    }
    await tx.insert(hrmsLeaveTypes).values({ id: TYPE, tenantId: TENANT, code: "CL", name: "Casual Leave", maxDays: 12, createdBy: HR, updatedBy: HR });
    await tx.insert(hrmsLeaveAllocs).values({ id: ALLOC, tenantId: TENANT, employeeId: EMP, leaveTypeId: TYPE, fy: "2026-27", totalDays: 12, balanceDays: 12, createdBy: HR, updatedBy: HR });
    // malformed legacy row: ends before it starts
    await tx.insert(hrmsLeaveApps).values({ id: INVERTED, tenantId: TENANT, employeeId: EMP, leaveTypeId: TYPE, allocId: ALLOC, fromDate: "2026-09-10", toDate: "2026-09-08", daysApplied: 1, reason: "Family function", status: "pending", createdBy: HR, updatedBy: HR });
    await tx.insert(hrmsLeaveApps).values({ id: NORMAL, tenantId: TENANT, employeeId: EMP, leaveTypeId: TYPE, allocId: ALLOC, fromDate: "2026-10-05", toDate: "2026-10-07", daysApplied: 3, reason: "Annual visit to native place", status: "approved", createdBy: HR, updatedBy: HR });
  });
});

afterAll(async () => { await sqlClient.end(); });

describe("leave clash predicate (UAT b23 P2)", () => {
  it("reports a malformed active row that starts on the requested from_date", async () => {
    const rows = await findOverlappingLeaveApps(TENANT, EMP, "2026-09-10", "2026-09-11");
    expect(rows.map((r) => r.id)).toContain(INVERTED);
  });

  it("still reports a normal overlapping range", async () => {
    const rows = await findOverlappingLeaveApps(TENANT, EMP, "2026-10-06", "2026-10-09");
    expect(rows.map((r) => r.id)).toEqual([NORMAL]);
  });

  it("reports nothing for a disjoint request, another employee, or another tenant", async () => {
    expect(await findOverlappingLeaveApps(TENANT, EMP, "2026-11-02", "2026-11-03")).toEqual([]);
    expect(await findOverlappingLeaveApps(TENANT, OTHER_EMP, "2026-09-10", "2026-09-11")).toEqual([]);
    expect(await findOverlappingLeaveApps(randomUUID(), EMP, "2026-09-10", "2026-09-11")).toEqual([]);
  });
});
