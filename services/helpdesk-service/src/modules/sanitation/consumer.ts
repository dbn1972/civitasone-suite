/**
 * Sanitation (BRD 5.13 SAN-001..004) — command consumers.
 *
 * The routes publish helpdesk.sanitation.* commands and return 202; nothing
 * consumed them (and the routes themselves were never registered in app.ts), so
 * no complaint was ever stored. Every handler: markProcessed (idempotent
 * redelivery) + a status-guarded tenant-scoped write + an audit event, all in
 * ONE transaction. A command whose preconditions no longer hold (complaint
 * missing, wrong status) is audited as rejected rather than thrown, so a stale
 * or duplicated command can never poison the queue.
 */
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import * as repo from "./repo.js";
import { canReopen, type ComplaintStatus } from "./domain.js";
import type { SanitationLocation } from "./schema.js";

const AUDIT = "audit.event.record";

type Msg = { tenantId: string; actorId: string; correlationId: string };
type Tx = Parameters<typeof enqueue>[0];

async function audit(
  tx: Tx, msg: Msg, action: string, resourceType: string, resourceId: string, outcome: string,
  extra: Record<string, unknown> = {},
) {
  await enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "helpdesk", action, resourceType, resourceId, outcome, ...extra },
  });
}

/**
 * Complaint reference derived from the command id: unique per complaint and
 * stable across redelivery/restarts (the in-process counter in domain.ts would
 * restart at 1 after every worker restart and collide on the
 * (tenant_id, complaint_number) unique index).
 */
export function complaintNumberFor(id: string, now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `SAN-${y}${m}${d}-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

type CreatePayload = {
  id: string; tenantId: string; reportedBy: string; location: SanitationLocation;
  facilityId?: string | null; complaintType: string; description?: string | null;
  photo?: string | null; severity: string;
};
type IdPayload = { id: string; tenantId: string };
type AssignPayload = IdPayload & { assignedTo: string };
type ResolvePayload = IdPayload & { resolution: string };
type ReopenPayload = IdPayload & { reason: string };
type FieldActionPayload = {
  id: string; tenantId: string; complaintId: string; actionType: string; performedBy: string;
  performedAt?: string | null; notes?: string | null; beforePhoto?: string | null;
  afterPhoto?: string | null; durationMinutes?: number | null;
};

export function registerSanitationConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe<CreatePayload>(COMMANDS.sanitationComplaintCreate, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertComplaint(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        complaintNumber: complaintNumberFor(p.id),
        reportedBy: p.reportedBy,
        location: p.location,
        facilityId: p.facilityId ?? null,
        complaintType: p.complaintType,
        description: p.description ?? null,
        photo: p.photo ?? null,
        severity: p.severity,
        status: "reported",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await audit(tx as Tx, msg, "complaint_create", "sanitation_complaint", p.id, "success");
    });
  });

  queue.subscribe<IdPayload>(COMMANDS.sanitationComplaintAcknowledge, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await repo.transitionComplaint(tx, p.id, msg.tenantId, ["reported"], {
        status: "acknowledged", updatedBy: msg.actorId,
      });
      await audit(tx as Tx, msg, "complaint_acknowledge", "sanitation_complaint", p.id, row ? "success" : "rejected_not_reported");
    });
  });

  queue.subscribe<AssignPayload>(COMMANDS.sanitationComplaintAssign, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await repo.transitionComplaint(tx, p.id, msg.tenantId, ["acknowledged", "reopened"], {
        status: "assigned", assignedTo: p.assignedTo, assignedAt: new Date(), updatedBy: msg.actorId,
      });
      await audit(tx as Tx, msg, "complaint_assign", "sanitation_complaint", p.id, row ? "success" : "rejected_invalid_status", { assignedTo: p.assignedTo });
    });
  });

  queue.subscribe<ResolvePayload>(COMMANDS.sanitationComplaintResolve, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await repo.transitionComplaint(tx, p.id, msg.tenantId, ["in_progress"], {
        status: "resolved", resolution: p.resolution, resolvedAt: new Date(), updatedBy: msg.actorId,
      });
      await audit(tx as Tx, msg, "complaint_resolve", "sanitation_complaint", p.id, row ? "success" : "rejected_not_in_progress");
    });
  });

  queue.subscribe<ReopenPayload>(COMMANDS.sanitationComplaintReopen, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const current = await repo.findComplaintTx(tx, p.id, msg.tenantId);
      // Re-check the reopen policy (resolved, within 48h, < 3 reopens) at apply
      // time: the route checked it at request time, but the window may have
      // closed while the command sat in the queue.
      if (!current || !canReopen(current.status as ComplaintStatus, current.resolvedAt, current.reopenCount)) {
        await audit(tx as Tx, msg, "complaint_reopen", "sanitation_complaint", p.id, current ? "rejected_cannot_reopen" : "rejected_not_found");
        return;
      }
      const row = await repo.transitionComplaint(tx, p.id, msg.tenantId, ["resolved"], {
        status: "reopened", reopenCount: current.reopenCount + 1, resolvedAt: null, updatedBy: msg.actorId,
      });
      await audit(tx as Tx, msg, "complaint_reopen", "sanitation_complaint", p.id, row ? "success" : "rejected_cannot_reopen", { reason: p.reason });
    });
  });

  // A field action is the first recorded piece of work on an assigned complaint,
  // so it also moves assigned -> in_progress (no other command does, and
  // resolve requires in_progress). Other statuses are left untouched.
  queue.subscribe<FieldActionPayload>(COMMANDS.sanitationFieldActionCreate, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const complaint = await repo.findComplaintTx(tx, p.complaintId, msg.tenantId);
      if (!complaint) {
        await audit(tx as Tx, msg, "field_action_create", "sanitation_field_action", p.id, "rejected_complaint_not_found");
        return;
      }
      await repo.insertFieldAction(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        complaintId: p.complaintId,
        actionType: p.actionType,
        performedBy: p.performedBy,
        ...(p.performedAt ? { performedAt: new Date(p.performedAt) } : {}),
        notes: p.notes ?? null,
        beforePhoto: p.beforePhoto ?? null,
        afterPhoto: p.afterPhoto ?? null,
        durationMinutes: p.durationMinutes ?? null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await repo.transitionComplaint(tx, p.complaintId, msg.tenantId, ["assigned"], {
        status: "in_progress", updatedBy: msg.actorId,
      });
      await audit(tx as Tx, msg, "field_action_create", "sanitation_field_action", p.id, "success", { complaintId: p.complaintId });
    });
  });
}
