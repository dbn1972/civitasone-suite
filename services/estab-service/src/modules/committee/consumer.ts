import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerCommitteeConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.committeeCreate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; name: string; purpose?: string; chairRef: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertCommittee(tx, {
        id: p.id, tenantId: p.tenantId, name: p.name, purpose: p.purpose ?? null,
        chairRef: p.chairRef, status: "active",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "committee", p.id);
    });
  });

  queue.subscribe(COMMANDS.meetingCreate, async (msg) => {
    const p = msg.payload as { id: string; committeeId: string; tenantId: string; title: string; whenAt: string; venue?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertMeeting(tx, {
        id: p.id, tenantId: p.tenantId, committeeId: p.committeeId,
        title: p.title, whenAt: new Date(p.whenAt), venue: p.venue ?? null,
        minutesUrl: null, status: "scheduled",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "meeting", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "committee_meetings", (msg.payload as any).committeeId));
  });

  queue.subscribe(COMMANDS.resolutionCreate, async (msg) => {
    const p = msg.payload as { id: string; meetingId: string; tenantId: string; body: string; actionOwner?: string; dueDate?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const seq = (await repo.countResolutions(tx, p.meetingId)) + 1;
      await repo.insertResolution(tx, {
        id: p.id, tenantId: p.tenantId, meetingId: p.meetingId, seq,
        body: p.body, actionOwner: p.actionOwner ?? null,
        dueDate: p.dueDate ?? null, status: "pending",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.resolutionCreated, eventType: EVENTS.resolutionCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { resolutionId: p.id, meetingId: p.meetingId },
      });
      await audit(tx, msg, "create", "resolution", p.id);
    });
  });

  queue.subscribe(COMMANDS.meetingMinutes, async (msg) => {
    const p = msg.payload as { meetingId: string; tenantId: string; minutesUrl: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.updateMeeting(tx, p.meetingId, { minutesUrl: p.minutesUrl, status: "held", updatedBy: msg.actorId });
      await audit(tx, msg, "minutes_upload", "meeting", p.meetingId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "meeting", p.meetingId));
    await cache.invalidate(cache.makeKey(msg.tenantId, "committee_meetings", (msg.payload as any).committeeId ?? ""));
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "estab", action, resourceType, resourceId, outcome: "success" },
  });
}
