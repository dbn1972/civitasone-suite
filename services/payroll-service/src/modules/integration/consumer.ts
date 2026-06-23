import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { CONSUMED_EVENTS } from "../../topics.js";
import * as lopRepo from "./lop-repo.js";
import * as statutoryRepo from "../statutory/repo.js";
import { computeGratuity } from "../payroll/domain.js";
import { randomUUID } from "node:crypto";
import { enqueue } from "../../shared/outbox.js";

const AUDIT = "audit.event.record";

export function registerIntegrationConsumers(queue: Queue): void {
  queue.subscribe(CONSUMED_EVENTS.leaveApproved, async (msg) => {
    const p = msg.payload as { employeeId: string; daysApplied: number; fromDate: string };
    const month = p.fromDate.slice(0, 7);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await lopRepo.upsertLopDays(tx, msg.tenantId, p.employeeId, month, "leave", p.daysApplied);
    });
  });

  queue.subscribe(CONSUMED_EVENTS.attendanceMarked, async (msg) => {
    const p = msg.payload as { employeeId: string; attendanceDate: string; status: string };
    if (p.status !== "absent" && p.status !== "half_day") return;
    const month = p.attendanceDate.slice(0, 7);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await lopRepo.upsertLopDays(tx, msg.tenantId, p.employeeId, month, "attendance", 1);
    });
  });

  queue.subscribe(CONSUMED_EVENTS.employeeSeparated, async (msg) => {
    const p = msg.payload as {
      employeeId: string; effectiveDate: string; basicMinor?: string; dateOfJoining?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const basicMinor = BigInt(p.basicMinor ?? "0");
      const join = new Date(p.dateOfJoining ?? p.effectiveDate);
      const sep = new Date(p.effectiveDate);
      const years = Math.max(0, (sep.getTime() - join.getTime()) / (365.25 * 86400000));
      const gratuityMinor = computeGratuity(years, basicMinor);
      if (gratuityMinor <= 0n) return;
      await statutoryRepo.insertGratuity(tx, {
        id: randomUUID(),
        tenantId: msg.tenantId,
        employeeId: p.employeeId,
        separationRef: `separation:${p.effectiveDate}`,
        yearsOfService: years.toFixed(2),
        lastBasicMinor: basicMinor,
        gratuityMinor,
        currency: "INR",
        status: "computed",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "payroll", action: "gratuity_compute", resourceType: "gratuity", resourceId: p.employeeId, outcome: "success" },
      });
    });
  });

  queue.subscribe(CONSUMED_EVENTS.financePaymentMade, async (msg) => {
    const p = msg.payload as { payrollRunId?: string; outcome?: string };
    if (!p.payrollRunId || p.outcome !== "success") return;
    const { markSlipsPaidForRun } = await import("../payroll/repo.js");
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await markSlipsPaidForRun(tx, p.payrollRunId!, msg.actorId);
    });
  });
}
