import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import {
  assertGrievanceTransition, inferPriority, inferDepartmentRef,
  shouldAutoEscalate, GRIEVANCE_ESCALATION_SLA_DAYS,
} from "./domain.js";

export function registerGrievanceConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.grievanceRegister, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; citizenId: string;
      category: string; subject: string; description: string;
    };
    const priority = inferPriority(p.category);
    const departmentRef = inferDepartmentRef(p.category);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertGrievance(tx, {
        id: p.id, tenantId: p.tenantId, citizenId: p.citizenId,
        category: p.category, subject: p.subject, description: p.description,
        priority, departmentRef, assignedTo: msg.actorId, status: "assigned",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await repo.insertAction(tx, {
        tenantId: p.tenantId, grievanceId: p.id, officerId: msg.actorId,
        actionType: "auto_assign", note: `Auto-assigned to ${departmentRef}`,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "register", "citizen_grievance", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "grievance", p.id));
  });

  queue.subscribe(COMMANDS.grievanceAssign, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; assignedTo: string; departmentRef?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const g = await repo.findGrievanceByIdTx(tx, p.id, msg.tenantId);
      if (!g) return;
      assertGrievanceTransition(g.status, "assigned");
      await repo.updateGrievance(tx, p.id, msg.tenantId, {
        status: "assigned", assignedTo: p.assignedTo,
        departmentRef: p.departmentRef ?? g.departmentRef,
        updatedBy: msg.actorId,
      });
      await repo.insertAction(tx, {
        tenantId: p.tenantId, grievanceId: p.id, officerId: msg.actorId,
        actionType: "assign", note: `Assigned to ${p.assignedTo}`,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "assign", "citizen_grievance", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "grievance", p.id));
  });

  queue.subscribe(COMMANDS.grievanceAction, async (msg) => {
    const p = msg.payload as {
      id: string; grievanceId: string; tenantId: string;
      actionType: string; note?: string; status?: "in_progress" | "resolved";
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const g = await repo.findGrievanceByIdTx(tx, p.grievanceId, msg.tenantId);
      if (!g) return;
      if (p.status) assertGrievanceTransition(g.status, p.status);
      await repo.insertAction(tx, {
        id: p.id, tenantId: p.tenantId, grievanceId: p.grievanceId,
        officerId: msg.actorId, actionType: p.actionType, note: p.note ?? null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      if (p.status) {
        await repo.updateGrievance(tx, p.grievanceId, msg.tenantId, { status: p.status, updatedBy: msg.actorId });
      }
      await audit(tx, msg, "action", "citizen_grievance", p.grievanceId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "grievance", p.grievanceId));
  });

  queue.subscribe(COMMANDS.grievanceResolve, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; note?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const g = await repo.findGrievanceByIdTx(tx, p.id, msg.tenantId);
      if (!g) return;
      assertGrievanceTransition(g.status, "resolved");
      await repo.updateGrievance(tx, p.id, msg.tenantId, { status: "resolved", updatedBy: msg.actorId });
      await repo.insertAction(tx, {
        tenantId: p.tenantId, grievanceId: p.id, officerId: msg.actorId,
        actionType: "resolve", note: p.note ?? null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.grievanceResolved, eventType: EVENTS.grievanceResolved,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { grievanceId: p.id, citizenId: g.citizenId },
      });
      await enqueue(tx, {
        topic: NOTIFICATION_SEND, eventType: NOTIFICATION_SEND,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: buildNotificationPayload({
          eventType: EVENTS.grievanceResolved,
          recipient: g.citizenId ?? p.id,
          recipientId: g.citizenId ?? undefined,
          variables: { grievanceId: p.id },
        }),
      });
      await audit(tx, msg, "resolve", "citizen_grievance", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "grievance", p.id));
  });

  queue.subscribe(COMMANDS.grievanceEscalate, async (msg) => {
    const p = msg.payload as {
      id: string; grievanceId: string; tenantId: string; reason: string; escalatedTo?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const g = await repo.findGrievanceByIdTx(tx, p.grievanceId, msg.tenantId);
      if (!g) return;
      await repo.insertEscalation(tx, {
        id: p.id, tenantId: p.tenantId, grievanceId: p.grievanceId,
        level: 1, reason: p.reason, escalatedTo: p.escalatedTo ?? null, status: "open",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.grievanceEscalated, eventType: EVENTS.grievanceEscalated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { grievanceId: p.grievanceId, reason: p.reason },
      });
      await enqueue(tx, {
        topic: NOTIFICATION_SEND, eventType: NOTIFICATION_SEND,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: buildNotificationPayload({
          eventType: EVENTS.grievanceEscalated,
          recipient: p.escalatedTo ?? g.departmentRef ?? "grievance-escalation",
          variables: { grievanceId: p.grievanceId, reason: p.reason },
        }),
      });
      await audit(tx, msg, "escalate", "citizen_grievance", p.grievanceId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "grievance", p.grievanceId));
  });

  queue.subscribe(COMMANDS.grievanceReopen, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const g = await repo.findGrievanceByIdTx(tx, p.id, msg.tenantId);
      if (!g) return;
      assertGrievanceTransition(g.status, "reopened");
      await repo.updateGrievance(tx, p.id, msg.tenantId, { status: "reopened", updatedBy: msg.actorId });
      await repo.insertAction(tx, {
        tenantId: p.tenantId, grievanceId: p.id, officerId: msg.actorId,
        actionType: "reopen", note: p.reason,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.grievanceReopened, eventType: EVENTS.grievanceReopened,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { grievanceId: p.id, reason: p.reason },
      });
      await audit(tx, msg, "reopen", "citizen_grievance", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "grievance", p.id));
  });

  queue.subscribe(COMMANDS.grievanceSlaCheck, async (msg) => {
    const p = msg.payload as { grievanceId: string; tenantId: string; slaDays?: number };
    const slaDays = p.slaDays ?? GRIEVANCE_ESCALATION_SLA_DAYS;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const g = await repo.findGrievanceByIdTx(tx, p.grievanceId, msg.tenantId);
      if (!g || !shouldAutoEscalate(g.status, g.updatedAt, slaDays)) return;
      const escalationId = randomUUID();
      await repo.insertEscalation(tx, {
        id: escalationId, tenantId: p.tenantId, grievanceId: p.grievanceId,
        level: 1, reason: `SLA breach after ${slaDays} days in assigned state`,
        escalatedTo: null, status: "open",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.grievanceEscalated, eventType: EVENTS.grievanceEscalated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { grievanceId: p.grievanceId, reason: "auto_escalation" },
      });
      await enqueue(tx, {
        topic: NOTIFICATION_SEND, eventType: NOTIFICATION_SEND,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: buildNotificationPayload({
          eventType: EVENTS.grievanceEscalated,
          recipient: g.departmentRef ?? "grievance-escalation",
          variables: { grievanceId: p.grievanceId, reason: "auto_escalation" },
        }),
      });
      await audit(tx, msg, "auto_escalate", "citizen_grievance", p.grievanceId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "grievance", p.grievanceId));
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: "audit.event.record", eventType: "audit.event.record",
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "citizen", action, resourceType, resourceId, outcome: "success" },
  });
}
