/**
 * Bugs 3 & 4 regression tests — approved leave no longer marks weekends or
 * holidays as "on_leave", and the holiday calendar it consults is the real,
 * tenant-configurable hrms_holidays table instead of a hardcoded, expiring
 * 2024-2026-only list.
 *
 * Before this fix, leave/holidays.ts's countWorkingDays() ended with
 * `return Math.max(count, 1)`, which made attendance/leave-sync.ts's
 * single-day guard (`countWorkingDays(dateStr, dateStr) >= 1`) ALWAYS true
 * regardless of input — every day in an approved leave's range, weekends and
 * holidays included, was marked "on_leave" in hrms_attendance via
 * onConflictDoUpdate, overwriting whatever was there.
 *
 * Live-DB integration test — same reasoning as the other Bug-1/2 suites:
 * hrms_attendance/hrms_holidays carry FORCE ROW LEVEL SECURITY and hrms_svc
 * has no BYPASSRLS, so every direct DB access goes through
 * runWithTenant(tenantId, () => db.transaction(tx => ...)).
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { hrmsEmployees } from "../employee/schema.js";
import { hrmsAttendance, type AttendanceRow } from "./schema.js";
import { hrmsHolidays } from "../holidays/schema.js";
import { markLeaveDaysOnAttendance } from "./leave-sync.js";

interface Seeded {
  tenantId: string;
  employeeId: string;
  actorId: string;
}

async function seedEmployee(): Promise<Seeded> {
  const tenantId = randomUUID();
  const employeeId = randomUUID();
  const actorId = randomUUID();
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.insert(hrmsEmployees).values({
      id: employeeId, tenantId,
      employeeNo: `LS-${employeeId.slice(0, 8)}`,
      fullName: "Leave Sync Test Employee",
      departmentId: randomUUID(), designationId: randomUUID(),
      dateOfJoining: "2020-01-01", status: "confirmed",
      createdBy: actorId, updatedBy: actorId,
    });
  }));
  return { tenantId, employeeId, actorId };
}

async function cleanupEmployee(tenantId: string, employeeId: string): Promise<void> {
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.id, employeeId));
  }));
}

async function getAttendance(tenantId: string, employeeId: string, date: string): Promise<AttendanceRow | undefined> {
  return runWithTenant(tenantId, () => db.transaction(async (tx) => {
    const [row] = await tx.select().from(hrmsAttendance).where(and(
      eq(hrmsAttendance.employeeId, employeeId), eq(hrmsAttendance.attendanceDate, date),
    ));
    return row;
  }));
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

/** A Friday/Saturday/Sunday/Monday block, always in the future relative to "now". */
function nextFriToMonBlock(): { friday: string; saturday: string; sunday: string; monday: string } {
  const today = new Date();
  let offsetToSaturday = (6 - today.getUTCDay() + 7) % 7;
  if (offsetToSaturday === 0) offsetToSaturday = 7;
  const saturday = addDays(today, offsetToSaturday);
  return {
    friday: isoDate(addDays(saturday, -1)),
    saturday: isoDate(saturday),
    sunday: isoDate(addDays(saturday, 1)),
    monday: isoDate(addDays(saturday, 2)),
  };
}

describe("Bugs 3 & 4 — leave-sync uses the real holiday calendar and skips non-working days", () => {
  it("approved leave spanning Fri(holiday)-Sat-Sun-Mon: only Monday is marked on_leave; the holiday and both weekend days are left untouched", async () => {
    const { tenantId, employeeId, actorId } = await seedEmployee();
    try {
      const { friday, saturday, sunday, monday } = nextFriToMonBlock();

      // Tenant-configured holiday on the Friday — proves the REAL,
      // DB-backed hrms_holidays calendar is consulted, not the old
      // hardcoded 2024-2026-only RESTRICTED_HOLIDAYS set (which covered
      // none of these dates regardless).
      await runWithTenant(tenantId, () => db.transaction(async (tx) => {
        await tx.insert(hrmsHolidays).values({
          id: randomUUID(), tenantId, name: "Test Holiday", date: friday,
          type: "gazetted", createdBy: actorId,
        });
      }));

      // A pre-existing manual "present" row on the Saturday — proves a
      // non-working day is left ALONE, not overwritten via
      // onConflictDoUpdate (the direct consequence half of the bug: Bug 4).
      await runWithTenant(tenantId, () => db.transaction(async (tx) => {
        await tx.insert(hrmsAttendance).values({
          id: randomUUID(), tenantId, employeeId, attendanceDate: saturday,
          status: "present", source: "manual", createdBy: actorId, updatedBy: actorId,
        });
      }));

      await runWithTenant(tenantId, () => db.transaction(async (tx) => {
        await markLeaveDaysOnAttendance(tx, {
          tenantId, employeeId, fromDate: friday, toDate: monday, actorId,
        });
      }));

      const fridayRow = await getAttendance(tenantId, employeeId, friday);
      expect(fridayRow).toBeUndefined(); // holiday: never touched

      const saturdayRow = await getAttendance(tenantId, employeeId, saturday);
      expect(saturdayRow?.status).toBe("present"); // weekend: pre-existing row left alone, not overwritten to on_leave

      const sundayRow = await getAttendance(tenantId, employeeId, sunday);
      expect(sundayRow).toBeUndefined(); // weekend: never touched

      const mondayRow = await getAttendance(tenantId, employeeId, monday);
      expect(mondayRow?.status).toBe("on_leave"); // the one real working day in range
      expect(mondayRow?.source).toBe("leave_approval");
    } finally {
      await cleanupEmployee(tenantId, employeeId);
    }
  });
});
