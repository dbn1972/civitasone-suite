import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { computeSeniority } from "./engine.js";
import { hrmsSeniorityLists, hrmsSeniorityListEntries } from "./schema.js";

const log = pino({ name: "seniority-consumer" });
const AUDIT = "audit.event.record";

/**
 * DOM-004 fix: both handlers below used to be `// TODO` stubs that persisted
 * nothing yet still enqueued a `success` audit event unconditionally — the
 * system reported "seniority list generated/approved" whether or not the
 * queue message even carried an actionable state change. The audit event is
 * now enqueued (in the same transaction as the write, so it can never be
 * observed decoupled from the write) only after a real, tenant-scoped row
 * change actually happened.
 */
export function registerSeniorityConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.seniorityGenerate, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      departmentId?: string;
      designationId?: string;
      asOf: string;
      requestedBy: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const filter: { departmentId?: string; designationId?: string } = {};
      if (p.departmentId) filter.departmentId = p.departmentId;
      if (p.designationId) filter.designationId = p.designationId;
      const ranked = await computeSeniority(tx, p.tenantId, filter, p.asOf);

      // Persist the snapshot header, then every ranked entry, before the
      // list can be considered "generated". An empty ranked list (no
      // matching employees) is still real persistence — a real, queryable,
      // zero-entry snapshot — not the no-op the stub used to be.
      await tx.insert(hrmsSeniorityLists).values({
        id: p.id,
        tenantId: p.tenantId,
        departmentId: p.departmentId ?? null,
        designationId: p.designationId ?? null,
        asOf: p.asOf,
        status: "generated",
        entryCount: ranked.length,
        generatedBy: p.requestedBy,
      });

      for (const r of ranked) {
        await tx.insert(hrmsSeniorityListEntries).values({
          tenantId: p.tenantId,
          seniorityListId: p.id,
          rank: r.rank,
          employeeId: r.employeeId,
          employeeNo: r.employeeNo,
          fullName: r.fullName,
          designationId: r.designationId,
          departmentId: r.departmentId,
          dateOfJoining: r.dateOfJoining,
          dateOfBirth: r.dateOfBirth,
          meritGrade: r.meritGrade == null ? null : r.meritGrade.toFixed(2),
          qualifyingYears: r.qualifyingYears.toFixed(2),
        });
      }

      await enqueue(tx, {
        topic: AUDIT,
        eventType: AUDIT,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "hrms",
          action: "generate",
          resourceType: "seniority_list",
          resourceId: p.id,
          outcome: "success",
          detail: { entryCount: ranked.length },
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "seniority", "list"));
    log.info({ messageId: msg.messageId }, "seniority list generation processed");
  });

  queue.subscribe(COMMANDS.seniorityApprove, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      seniorityListId: string;
      approvedBy: string;
      remarks?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Tenant-scoped, status-guarded UPDATE: only a list that (a) belongs
      // to this tenant and (b) is still in "generated" state can be
      // approved. Mirrors the tx-scoped-findById pattern used elsewhere in
      // this codebase to avoid acking success under RLS when nothing
      // actually matched (see TX-003).
      const updated = await tx.update(hrmsSeniorityLists)
        .set({
          status: "approved",
          approvedBy: p.approvedBy,
          approvedAt: new Date(),
          remarks: p.remarks ?? null,
          updatedAt: new Date(),
        })
        .where(and(
          eq(hrmsSeniorityLists.tenantId, p.tenantId),
          eq(hrmsSeniorityLists.id, p.seniorityListId),
          eq(hrmsSeniorityLists.status, "generated"),
        ))
        .returning({ id: hrmsSeniorityLists.id });

      if (updated.length === 0) {
        log.warn(
          { messageId: msg.messageId, seniorityListId: p.seniorityListId },
          "seniority list approve: no matching generated list found for this tenant — nothing approved, no audit emitted",
        );
        return;
      }

      await enqueue(tx, {
        topic: AUDIT,
        eventType: AUDIT,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "hrms",
          action: "approve",
          resourceType: "seniority_list",
          resourceId: p.seniorityListId,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "seniority", p.seniorityListId));
    log.info({ messageId: msg.messageId }, "seniority list approval processed");
  });

  log.info("seniority consumers registered");
}
