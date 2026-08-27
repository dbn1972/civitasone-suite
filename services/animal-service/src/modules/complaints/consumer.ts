import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { cache } from "../../shared/infra.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { generateComplaintNumber, routeComplaint } from "./domain.js";

const log = pino({ name: "animal.complaints.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerComplaintConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.reportComplaint, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      location: Record<string, unknown>;
      animalType: string;
      complaintType: string;
      description?: string;
      photo?: string;
      severity: string;
    };
    const complaintNumber = generateComplaintNumber("ULB", Date.now() % 999999);
    const suggestedTeam = routeComplaint(p.animalType, p.severity);

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertComplaint(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        complaintNumber,
        reportedBy: msg.actorId,
        location: p.location as never,
        animalType: p.animalType,
        complaintType: p.complaintType,
        description: p.description ?? null,
        photo: p.photo ?? null,
        severity: p.severity,
        status: "reported",
        assignedTo: null,
        assignedTeam: suggestedTeam,
        resolvedAt: null,
        resolution: null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.complaintReported,
        eventType: EVENTS.complaintReported,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { complaintId: p.id, complaintNumber, animalType: p.animalType, severity: p.severity },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "complaint.report",
        resourceType: "animal_complaint",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id, complaintNumber }, "animal complaint reported");
  });

  queue.subscribe(COMMANDS.assignComplaint, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; assignedTo: string; assignedTeam: string };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "assigned", msg.actorId, {
        assignedTo: p.assignedTo,
        assignedTeam: p.assignedTeam,
      });
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.complaintAssigned,
        eventType: EVENTS.complaintAssigned,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { complaintId: p.id, assignedTo: p.assignedTo, assignedTeam: p.assignedTeam },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "complaint.assign",
        resourceType: "animal_complaint",
        resourceId: p.id,
      });
    });
    // GET /v1/animal/complaints/:id (complaints/routes.ts) serves through a
    // read-through cache that only this write path can invalidate (CLAUDE.md §6).
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "complaint", p.id));
  });

  queue.subscribe(COMMANDS.dispatchTeam, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "dispatched", msg.actorId);
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.teamDispatched,
        eventType: EVENTS.teamDispatched,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { complaintId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "complaint.dispatch",
        resourceType: "animal_complaint",
        resourceId: p.id,
      });
    });
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "complaint", p.id));
  });

  queue.subscribe(COMMANDS.closeComplaint, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; resolution: string };
    let applied = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ok = await repo.updateStatus(tx, p.id, msg.tenantId, "closed", msg.actorId, {
        resolvedAt: new Date(),
        resolution: p.resolution,
      });
      if (!ok) return;
      applied = true;
      await enqueue(tx, {
        topic: EVENTS.complaintClosed,
        eventType: EVENTS.complaintClosed,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { complaintId: p.id, resolution: p.resolution },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "complaint.close",
        resourceType: "animal_complaint",
        resourceId: p.id,
      });
    });
    if (applied) await cache.invalidate(cache.makeKey(msg.tenantId, "complaint", p.id));
  });
}
