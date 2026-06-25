import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, CONSUMES, SOURCE, RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

type CreatePayload = {
  id: string;
  tenantId: string;
  subject: string;
  description: string | null;
  priority: string;
  status: string;
};

type AssignPayload = {
  id: string;
  tenantId: string;
  assigneeId: string;
};

/** telephony.call.missed event payload (foreign producer — HD2). */
type CallMissedPayload = {
  callId: string;
  status?: string;
  tenantId?: string;
};

function keyFor(tenantId: string, id: string) {
  return cache.makeKey(tenantId, RESOURCE, id);
}

export function registerTicketConsumers(queue: Queue): void {
  // ---- create -------------------------------------------------------------
  queue.subscribe<CreatePayload>(COMMANDS.createTicket, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      await repo.insert(tx, {
        id: p.id,
        tenantId: p.tenantId,
        subject: p.subject,
        description: p.description,
        priority: p.priority,
        status: p.status,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      await emit(tx, msg, EVENTS.ticketCreated, { ticketId: p.id, subject: p.subject }, "create", p.id);
    });
    const row = await repo.findById(msg.payload.id, msg.tenantId);
    if (row) await cache.put(keyFor(msg.tenantId, msg.payload.id), row);
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });

  // ---- HD2: assign --------------------------------------------------------
  queue.subscribe<AssignPayload>(COMMANDS.assignTicket, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      const updated = await repo.assign(tx, p.id, p.tenantId, p.assigneeId, msg.actorId, new Date());
      if (!updated) {
        // ticket not found in this tenant — audit the rejection, do not throw.
        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { service: "helpdesk", action: "assign", resourceType: "ticket", resourceId: p.id, outcome: "rejected_not_found" },
        });
        return;
      }
      await emit(tx, msg, EVENTS.ticketAssigned, { ticketId: p.id, assigneeId: p.assigneeId }, "assign", p.id);
    });
    const row = await repo.findById(msg.payload.id, msg.tenantId);
    if (row) await cache.put(keyFor(msg.tenantId, msg.payload.id), row);
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });

  // ---- HD2: inbound linkage — a missed telephony call auto-opens a ticket --
  // Idempotent on (tenant, source=telephony, source_ref=callId): redelivery of
  // the same call event yields exactly one ticket.
  queue.subscribe<CallMissedPayload>(CONSUMES.telephonyCallMissed, async (msg) => {
    const callId = msg.payload.callId;
    if (!callId) return; // malformed event — nothing to link
    let openedId: string | null = null;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const { id, created } = await repo.insertLinkedIdempotent(tx, {
        tenantId: msg.tenantId,
        subject: `Missed call callback — ${callId}`,
        description: `Auto-opened from telephony.call.missed for call ${callId}.`,
        priority: "High",
        status: "open",
        source: SOURCE.telephony,
        sourceRef: callId,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      openedId = id;
      if (created) {
        await emit(tx, msg, EVENTS.ticketCreated, { ticketId: id, subject: `Missed call callback — ${callId}`, source: SOURCE.telephony, sourceRef: callId }, "create", id);
      }
    });
    if (openedId) {
      const row = await repo.findById(openedId, msg.tenantId);
      if (row) await cache.put(keyFor(msg.tenantId, openedId), row);
      await cache.invalidateResource(msg.tenantId, RESOURCE);
    }
  });
}

async function emit(
  tx: unknown,
  msg: CommandEnvelope,
  eventType: string,
  payload: Record<string, unknown>,
  action: string,
  resourceId: string
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, {
    topic: eventType,
    eventType,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload,
  });
  await enqueue(t, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "helpdesk", action, resourceType: "ticket", resourceId, outcome: "success" },
  });
}
