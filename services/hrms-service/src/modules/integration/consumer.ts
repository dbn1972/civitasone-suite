import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { CONSUMED_EVENTS } from "../../topics.js";
import { hrmsLeaveTypes } from "../leave/schema.js";
import { cache } from "../../shared/infra.js";
import * as employeeRepo from "../employee/repo.js";

const AUDIT_TOPIC = "audit.event.record";

/** Seed default leave types when a tenant is provisioned. */
export function registerIntegrationConsumers(queue: Queue): void {
  queue.subscribe(CONSUMED_EVENTS.tenantCreated, async (msg) => {
    const p = msg.payload as { tenantId: string };
    if (!p.tenantId) return;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const actor = msg.actorId;
      const rows = [
        { code: "EL", name: "Earned Leave", maxDays: 30, carryForward: true },
        { code: "CL", name: "Casual Leave", maxDays: 15, carryForward: false },
        { code: "HPL", name: "Half Pay Leave", maxDays: 20, carryForward: false },
      ];
      for (const row of rows) {
        await tx.insert(hrmsLeaveTypes).values({
          id: randomUUID(),
          tenantId: p.tenantId,
          code: row.code,
          name: row.name,
          maxDays: row.maxDays,
          isEncashable: false,
          carryForward: row.carryForward,
          createdBy: actor,
          updatedBy: actor,
        });
      }
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "hrms", action: "seed_leave_types", resourceType: "leave_type", resourceId: p.tenantId, outcome: "success" },
      });
    });
  });

  // HIGH fix: payroll-service creates/approves a salary revision in a
  // single step (payroll.payroll_salary_revisions has no separate approval
  // status -- the creating actor is recorded as approved_by) and already
  // published payroll.salary_revision.created (see fnf/consumer.ts's
  // sibling salaryRevisionCreate handler in payroll-service), but nothing in
  // hrms-service consumed it -- hrmsEmployees.basicMinor went stale the
  // moment a revision landed in payroll's own database, and hrms-service's
  // own separation/gratuity computation (employee/consumer.ts's
  // employeeSeparate handler) reads emp.basicMinor directly, so a stale
  // figure could be used at exit.
  //
  // Applies the SAME optimistic-concurrency-guarded write path basicMinor
  // already uses for every other writer (pay-matrix annual increment,
  // direct/eOffice-approved promotion, the generic employeeUpdate command --
  // see employee/repo.ts's updateEmployeeVersioned doc comment), so this can
  // never race one of those and silently lose or clobber.
  queue.subscribe(CONSUMED_EVENTS.salaryRevisionCreated, async (msg) => {
    const p = msg.payload as { id: string; employeeId: string; newBasicMinor: number };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const current = await employeeRepo.findVersionForUpdate(tx, p.employeeId, msg.tenantId);
      if (!current) {
        // Employee doesn't exist in HRMS under this tenant -- nothing to
        // sync. Not treated as an error (no throw -> no DLQ/retry loop):
        // the two services are genuinely separate databases with no FK, and
        // this can legitimately race an employee being removed/re-keyed
        // between the revision landing in payroll and this event arriving.
        return;
      }
      await employeeRepo.updateEmployeeVersioned(
        tx, p.employeeId, msg.tenantId, current.version,
        { basicMinor: BigInt(Math.trunc(p.newBasicMinor)) },
        msg.actorId,
      );
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "hrms", action: "sync_basic_pay_from_salary_revision", resourceType: "employee",
          resourceId: p.employeeId, outcome: "success", metadata: { salaryRevisionId: p.id },
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "employee", p.employeeId));
  });
}
