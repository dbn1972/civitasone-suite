/**
 * PR #2459 review B1: persists opening YTD records and their maker-checker
 * decisions, idempotently (markProcessed), each audited in the same transaction.
 */
import type { Queue } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { payrollOpeningYtd } from "../payroll/schema.js";
import type { CreateOpeningYtdBody } from "./validators.js";

const AUDIT = "audit.event.record";

export function registerOpeningYtdConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.openingYtdCreate, async (msg) => {
    const p = msg.payload as CreateOpeningYtdBody & { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const inserted = await tx.insert(payrollOpeningYtd).values({
        id: p.id, tenantId: p.tenantId, employeeId: p.employeeId, fy: p.fy, source: p.source,
        months: p.source === "pre_go_live" ? p.months : 0,
        salaryMinor: BigInt(p.salaryMinor), tdsMinor: BigInt(p.tdsMinor),
        priorEmployerName: p.priorEmployerName ?? null, priorEmployerTan: p.priorEmployerTan ?? null,
        note: p.note, status: "pending", enteredBy: msg.actorId,
      }).onConflictDoNothing().returning({ id: payrollOpeningYtd.id });
      // A live record for the same employee / FY / source won the race: recorded as a failed attempt.
      const outcome = inserted.length > 0 ? "success" : "failure";
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "payroll", action: "opening_ytd_enter", resourceType: "payroll_opening_ytd", resourceId: p.id, outcome,
          newValue: { employeeId: p.employeeId, fy: p.fy, source: p.source, months: p.months, salaryMinor: p.salaryMinor, tdsMinor: p.tdsMinor, priorEmployerName: p.priorEmployerName ?? null, priorEmployerTan: p.priorEmployerTan ?? null },
          reason: p.note,
        },
      });
    });
  });

  queue.subscribe(COMMANDS.openingYtdDecide, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; decision: "approved" | "rejected"; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const [row] = await tx.select().from(payrollOpeningYtd)
        .where(and(eq(payrollOpeningYtd.id, p.id), eq(payrollOpeningYtd.tenantId, p.tenantId))).for("update").limit(1);
      if (!row) throw new NonRetryableError(`opening YTD ${p.id} not found`);
      if (row.status !== "pending") return; // decided meanwhile
      if (row.enteredBy === msg.actorId) throw new NonRetryableError("MAKER_CHECKER_VIOLATION: the opening YTD maker cannot decide it");
      const now = new Date();
      await tx.update(payrollOpeningYtd).set({ status: p.decision, approvedBy: msg.actorId, decidedAt: now, decisionNote: p.reason, updatedAt: now, version: row.version + 1 })
        .where(and(eq(payrollOpeningYtd.id, p.id), eq(payrollOpeningYtd.tenantId, p.tenantId)));
      await enqueue(tx, {
        topic: AUDIT, eventType: AUDIT, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "payroll", action: p.decision === "approved" ? "opening_ytd_approve" : "opening_ytd_reject",
          resourceType: "payroll_opening_ytd", resourceId: p.id, outcome: "success",
          oldValue: { status: "pending" }, newValue: { status: p.decision, employeeId: row.employeeId, fy: row.fy, source: row.source, salaryMinor: row.salaryMinor.toString(), tdsMinor: row.tdsMinor.toString(), enteredBy: row.enteredBy },
          reason: p.reason,
        },
      });
    });
  });
}
