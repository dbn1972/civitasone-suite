import { randomUUID } from "node:crypto";
import * as attendanceRepo from "./repo.js";
import { getHolidaysInRangeTx, isWeekend } from "../leave/rules-engine.js";

/**
 * Bug fix: this used to source holidays from leave/holidays.ts's hardcoded
 * RESTRICTED_HOLIDAYS (four fixed dates/year, 2024-2026 only — nothing for
 * any date beyond 2026-12-25) via its countWorkingDays(), whose own
 * `Math.max(count, 1)` floor made the single-day guard below
 * (previously `countWorkingDays(dateStr, dateStr) >= 1`) ALWAYS true
 * regardless of input — so every day in an approved leave's date range,
 * weekends and holidays included, was marked "on_leave" in hrms_attendance,
 * overwriting whatever was there. Now uses the real, tenant-configurable
 * hrms_holidays calendar (leave/rules-engine.ts — the same source
 * leave-application validation already uses) and correctly skips weekends
 * and holidays instead of marking them.
 *
 * Uses getHolidaysInRangeTx (not getHolidaysInRange) deliberately: this
 * function always runs with an already-open `tx` (its caller,
 * leave/consumer.ts's leaveApprove, opens the transaction and passes it
 * in) — getHolidaysInRange's scopedRead opens its OWN nested
 * db.transaction(), which from inside an already-open one risks the
 * connection-pool deadlock documented on getHolidaysInRangeTx / on
 * employee/repo.ts's findByIdTx.
 */
export async function markLeaveDaysOnAttendance(
  tx: Parameters<typeof attendanceRepo.upsertAttendance>[0],
  params: {
    tenantId: string;
    employeeId: string;
    fromDate: string;
    toDate: string;
    actorId: string;
  },
): Promise<void> {
  const holidays = new Set(await getHolidaysInRangeTx(tx, params.tenantId, params.fromDate, params.toDate));
  const from = new Date(`${params.fromDate}T00:00:00Z`);
  const to = new Date(`${params.toDate}T00:00:00Z`);
  const cur = new Date(from);
  while (cur <= to) {
    const dateStr = cur.toISOString().slice(0, 10);
    if (!isWeekend(dateStr) && !holidays.has(dateStr)) {
      await attendanceRepo.upsertAttendance(tx, {
        id: randomUUID(),
        tenantId: params.tenantId,
        employeeId: params.employeeId,
        attendanceDate: dateStr,
        status: "on_leave",
        source: "leave_approval",
        createdBy: params.actorId,
        updatedBy: params.actorId,
      });
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
}
