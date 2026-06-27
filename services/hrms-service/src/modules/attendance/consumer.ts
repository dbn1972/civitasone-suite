import type { Queue } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT = "audit.event.record";

export function registerAttendanceConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.attendanceMark, async (msg) => {
    const p = msg.payload as {
      batchId: string; tenantId: string;
      records: Array<{ employeeId: string; attendanceDate: string; status: string; inTime?: string; outTime?: string; shiftId?: string; lateMins?: number; source?: string }>;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      for (const r of p.records) {
        await repo.upsertAttendance(tx, {
          id: randomUUID(), tenantId: p.tenantId,
          employeeId: r.employeeId, attendanceDate: r.attendanceDate,
          status: r.status, inTime: r.inTime ?? null, outTime: r.outTime ?? null,
          shiftId: r.shiftId ?? null, lateMins: r.lateMins ?? 0, source: r.source ?? "manual",
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await enqueue(tx, {
          topic: EVENTS.attendanceMarked, eventType: EVENTS.attendanceMarked,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { employeeId: r.employeeId, attendanceDate: r.attendanceDate, status: r.status },
        });
        await cache.invalidate(cache.makeKey(p.tenantId, "attendance_emp_month", `${r.employeeId}:${r.attendanceDate.slice(0, 7)}`));
      }
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "hrms", action: "mark_bulk", resourceType: "attendance", resourceId: p.batchId, count: p.records.length, outcome: "success" },
      });
    });
  });

  queue.subscribe(COMMANDS.regularisationCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; employeeId: string;
      date: string; requestedStatus: string; reason: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertRegularisation(tx, {
        id: p.id,
        tenantId: p.tenantId,
        employeeId: p.employeeId,
        date: p.date,
        requestedStatus: p.requestedStatus,
        reason: p.reason,
        status: "pending",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "hrms", action: "regularisation_create", resourceType: "attendance_regularisation", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "attendance_reg", `list:100`));
  });
}
