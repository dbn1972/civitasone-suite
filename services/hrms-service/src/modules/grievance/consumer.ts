/**
 * Grievance register consumers (GAP-HR-GRIEVANCE-01/02/03): register, assign,
 * dispose, plus the DPDP detail-read audit.
 *
 * The routes validate up front and 4xx on anything they can see; these
 * handlers re-assert what can change between publish and consume (case still
 * open, grievant exists) with a race-safe conditional UPDATE, and every
 * mutation writes its row, a history event and an `audit.event.record` outbox
 * event in ONE transaction. The audit metadata never carries the free-text
 * subject/description (PII).
 */
import { NonRetryableError, type Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { hrmsEmployees } from "../employee/schema.js";
import { resolveEmployeeForActor } from "../employee/actor-link.js";
import * as repo from "./repo.js";
import { istYear, OPEN_STATUSES } from "./domain.js";

const log = pino({ name: "hrms-grievance" });
const AUDIT = "audit.event.record";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Meta = { tenantId: string; actorId: string; correlationId: string };

async function audit(tx: Tx, msg: Meta, action: string, resourceId: string, metadata: Record<string, unknown>): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "hrms", action, resourceType: "grievance", resourceId, outcome: "success", metadata },
  });
}

async function employeeExistsTx(tx: Tx, tenantId: string, id: string): Promise<boolean> {
  const rows = await tx.select({ id: hrmsEmployees.id }).from(hrmsEmployees)
    .where(and(eq(hrmsEmployees.tenantId, tenantId), eq(hrmsEmployees.id, id))).limit(1);
  return rows.length > 0;
}

export function registerGrievanceConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.grievanceRegister, async (msg) => {
    const p = msg.payload as { id: string; employeeId: string; category: string; subject: string; description: string; filedDate: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      if (!(await employeeExistsTx(tx, msg.tenantId, p.employeeId))) {
        throw new NonRetryableError(`grievance employee ${p.employeeId} not found`);
      }
      const caseNo = await repo.nextCaseNoTx(tx, msg.tenantId, istYear(new Date()));
      const inserted = await repo.insertTx(tx, {
        id: p.id, tenantId: msg.tenantId, caseNo, employeeId: p.employeeId,
        category: p.category, subject: p.subject, description: p.description,
        filedDate: p.filedDate, status: "registered",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      if (!inserted) return; // same grievance id already registered
      await repo.insertEventTx(tx, {
        tenantId: msg.tenantId, grievanceId: p.id, action: "register",
        fromStatus: null, toStatus: "registered", actorId: msg.actorId,
      });
      await audit(tx, msg, "register", p.id, { caseNo, employeeId: p.employeeId, category: p.category });
    });
    log.info({ messageId: msg.messageId }, "grievance registered");
  });

  queue.subscribe(COMMANDS.grievanceAssign, async (msg) => {
    const p = msg.payload as { id: string; assigneeEmployeeId: string; note: string | null };
    // Resolved BEFORE the transaction (it opens its own scoped read).
    const actorEmpId = (await resolveEmployeeForActor(msg.tenantId, msg.actorId))?.id ?? null;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      if (!(await employeeExistsTx(tx, msg.tenantId, p.assigneeEmployeeId))) {
        throw new NonRetryableError(`grievance assignee ${p.assigneeEmployeeId} not found`);
      }
      const cur = await repo.findByIdTx(tx, msg.tenantId, p.id);
      if (!cur) throw new NonRetryableError(`grievance ${p.id} not found`);
      if (actorEmpId && cur.employeeId === actorEmpId) {
        throw new NonRetryableError("CONFLICT_OF_INTEREST: the acting user is the complainant of this grievance");
      }
      if (cur.employeeId === p.assigneeEmployeeId) {
        throw new NonRetryableError("CONFLICT_OF_INTEREST: a grievance cannot be assigned to the employee who filed it");
      }
      const moved = await repo.transitionTx(tx, msg.tenantId, p.id, msg.actorId, {
        from: OPEN_STATUSES, to: "under_inquiry",
        set: { assignedTo: p.assigneeEmployeeId, assignedAt: new Date() },
      });
      if (!moved) { log.warn({ id: p.id }, "grievance assign skipped: no longer open"); return; }
      await repo.insertEventTx(tx, {
        tenantId: msg.tenantId, grievanceId: p.id, action: "assign",
        fromStatus: moved.fromStatus, toStatus: "under_inquiry", actorId: msg.actorId,
        assignedTo: p.assigneeEmployeeId, note: p.note,
      });
      await audit(tx, msg, "assign", p.id, {
        caseNo: moved.row.caseNo, assignedTo: p.assigneeEmployeeId, previousAssignee: cur.assignedTo,
      });
    });
    log.info({ messageId: msg.messageId }, "grievance assigned");
  });

  queue.subscribe(COMMANDS.grievanceDispose, async (msg) => {
    const p = msg.payload as { id: string; disposition: string; remarks: string };
    const actorEmpId = (await resolveEmployeeForActor(msg.tenantId, msg.actorId))?.id ?? null;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const before = await repo.findByIdTx(tx, msg.tenantId, p.id);
      if (before && actorEmpId && before.employeeId === actorEmpId) {
        throw new NonRetryableError("CONFLICT_OF_INTEREST: the acting user is the complainant of this grievance");
      }
      const moved = await repo.transitionTx(tx, msg.tenantId, p.id, msg.actorId, {
        from: OPEN_STATUSES, to: "disposed",
        set: { disposition: p.disposition, disposalRemarks: p.remarks, disposedAt: new Date(), disposedBy: msg.actorId },
      });
      // Lost the race (or already disposed): the first dispose stands.
      if (!moved) { log.warn({ id: p.id }, "grievance dispose skipped: already disposed or missing"); return; }
      await repo.insertEventTx(tx, {
        tenantId: msg.tenantId, grievanceId: p.id, action: "dispose",
        fromStatus: moved.fromStatus, toStatus: "disposed", actorId: msg.actorId, note: p.remarks,
      });
      await audit(tx, msg, "dispose", p.id, { caseNo: moved.row.caseNo, disposition: p.disposition });
    });
    log.info({ messageId: msg.messageId }, "grievance disposed");
  });

  queue.subscribe(COMMANDS.grievanceRead, async (msg) => {
    const p = msg.payload as { id: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await audit(tx, msg, "read", p.id, {});
    });
  });

  log.info("grievance consumers registered");
}
