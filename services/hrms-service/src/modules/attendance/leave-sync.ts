import { randomUUID } from "node:crypto";
import * as attendanceRepo from "./repo.js";
import { countWorkingDays } from "../leave/holidays.js";

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
  const from = new Date(`${params.fromDate}T00:00:00Z`);
  const to = new Date(`${params.toDate}T00:00:00Z`);
  const cur = new Date(from);
  while (cur <= to) {
    const dateStr = cur.toISOString().slice(0, 10);
    if (countWorkingDays(dateStr, dateStr) >= 1) {
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
