import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { generateComplaintNumber, canTransition, canReopen } from "./domain.js";
import type { SanitationLocation } from "./schema.js";

const log = pino({ name: "helpdesk.sanitation.consumer" });
const AUDIT = "audit.event.record";

type Msg = { tenantId: string; actorId: string; correlationId: string; messageId: string };
type Tx = Parameters<typeof enqueue>[0];

function audit(tx: Tx, msg: Msg, action: string, resourceId: string, outcome = "success"): Promise<unknown> {
  return enqueue(tx, {
    topic: AUDIT,
    eventType: AUDIT,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "helpdesk", action, resourceType: "sanitation_complaint", resourceId, outcome },
  });
}

function event(tx: Tx, msg: Msg, eventType: string, payload: Record<string, unknown>): Promise<unknown> {
  return enqueue(tx, {
    topic: eventType,
    eventType,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload,
  });
}

export function registerSanitationConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.sanitationComplaintCreate, async (msg) => {
    const p = msg.payload as Record<string, unknown> & { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const complaintNumber = generateComplaintNumber();
      try {
        await repo.insertComplaint(tx as repo.Writer, {
          id: p.id,
          tenantId: p.tenantId,
          complaintNumber,
          reportedBy: (p.reportedBy as string) ?? msg.actorId,
          location: p.location as SanitationLocation,
          facilityId: (p.facilityId as string | null) ?? null,
          complaintType: p.complaintType as string,
          description: (p.description as string | null) ?? null,
          photo: (p.photo as string | null) ?? null,
          severity: p.severity as string,
          status: "reported",
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });
        await event(tx as Tx, msg, EVENTS.sanitationComplaintCreated, {
          complaintId: p.id,
          complaintNumber,
          complaintType: p.complaintType,
          severity: p.severity,
          location: p.location,
        });
        await audit(tx, msg, "create_sanitation_complaint", p.id);
      } catch (err) {
        if ((err as { code?: string }).code === "23505") {
          await audit(tx, msg, "create_sanitation_complaint", p.id, "rejected_duplicate");
        } else {
          throw err;
        }
      }
    });
    log.info({ id: p.id }, "sanitation complaint created");
  });

  queue.subscribe(COMMANDS.sanitationComplaintAcknowledge, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const complaint = await repo.findComplaint(p.id, p.tenantId);
      if (!complaint) return;
      if (!canTransition(complaint.status as Parameters<typeof canTransition>[0], "acknowledged")) return;
      await repo.updateComplaint(tx as repo.Writer, p.id, p.tenantId, {
        status: "acknowledged",
        updatedBy: msg.actorId,
      });
      await audit(tx as Tx, msg, "acknowledge_sanitation_complaint", p.id);
    });
  });

  queue.subscribe(COMMANDS.sanitationComplaintAssign, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; assignedTo: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const complaint = await repo.findComplaint(p.id, p.tenantId);
      if (!complaint) return;
      if (!canTransition(complaint.status as Parameters<typeof canTransition>[0], "assigned")) return;
      await repo.updateComplaint(tx as repo.Writer, p.id, p.tenantId, {
        status: "assigned",
        assignedTo: p.assignedTo,
        assignedAt: new Date(),
        updatedBy: msg.actorId,
      });
      await audit(tx as Tx, msg, "assign_sanitation_complaint", p.id);
    });
  });

  queue.subscribe(COMMANDS.sanitationComplaintResolve, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; resolution: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const complaint = await repo.findComplaint(p.id, p.tenantId);
      if (!complaint) return;
      if (!canTransition(complaint.status as Parameters<typeof canTransition>[0], "resolved")) return;
      const now = new Date();
      await repo.updateComplaint(tx as repo.Writer, p.id, p.tenantId, {
        status: "resolved",
        resolvedAt: now,
        resolution: p.resolution,
        updatedBy: msg.actorId,
      });
      await event(tx as Tx, msg, EVENTS.sanitationComplaintResolved, {
        complaintId: p.id,
        resolution: p.resolution,
      });
      await audit(tx as Tx, msg, "resolve_sanitation_complaint", p.id);
    });
  });

  queue.subscribe(COMMANDS.sanitationComplaintReopen, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const complaint = await repo.findComplaint(p.id, p.tenantId);
      if (!complaint) return;
      if (!canReopen(
        complaint.status as Parameters<typeof canReopen>[0],
        complaint.resolvedAt,
        complaint.reopenCount,
      )) return;
      await repo.updateComplaint(tx as repo.Writer, p.id, p.tenantId, {
        status: "reopened",
        resolvedAt: null,
        resolution: null,
        reopenCount: complaint.reopenCount + 1,
        updatedBy: msg.actorId,
      });
      await event(tx as Tx, msg, EVENTS.sanitationComplaintReopened, {
        complaintId: p.id,
        reason: p.reason,
        reopenCount: complaint.reopenCount + 1,
      });
      await audit(tx as Tx, msg, "reopen_sanitation_complaint", p.id);
    });
  });

  queue.subscribe(COMMANDS.sanitationFieldActionCreate, async (msg) => {
    const p = msg.payload as Record<string, unknown> & { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertFieldAction(tx as repo.Writer, {
        id: p.id,
        tenantId: p.tenantId,
        complaintId: p.complaintId as string,
        actionType: p.actionType as string,
        performedBy: (p.performedBy as string) ?? msg.actorId,
        performedAt: p.performedAt ? new Date(p.performedAt as string) : new Date(),
        notes: (p.notes as string | null) ?? null,
        beforePhoto: (p.beforePhoto as string | null) ?? null,
        afterPhoto: (p.afterPhoto as string | null) ?? null,
        durationMinutes: (p.durationMinutes as number | null) ?? null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await audit(tx as Tx, msg, "create_sanitation_field_action", p.id);
    });
    log.info({ id: p.id }, "sanitation field action created");
  });
}
