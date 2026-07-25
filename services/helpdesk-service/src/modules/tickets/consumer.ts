import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, CONSUMES, SOURCE, RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import { randomUUID } from "node:crypto";
import { tickets } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";

type CreatePayload = {
  // Internal intake supplies id + status; the cross-service knowledge-assistant
  // escalate-to-ticket handoff (LOOP 1) omits both and instead carries a source
  // tag + externalRef, so these are optional.
  id?: string;
  tenantId?: string;
  subject: string;
  description?: string | null;
  priority?: string;
  status?: string;
  ticketType?: string | null;
  typeFields?: Record<string, unknown> | null;
  assetIds?: string[] | null;
  assetVerified?: boolean;
  // LOOP 1 — knowledge-service assistant escalate-to-ticket handoff.
  source?: string;
  externalRef?: string;
};

type AssignPayload = {
  id: string;
  tenantId: string;
  assigneeId: string;
};

type TransitionPayload = {
  id: string;
  tenantId: string;
  newStatus: string;
};

/** telephony.call.missed event payload (foreign producer — HD2). */
type CallMissedPayload = {
  callId: string;
  status?: string;
  tenantId?: string;
};

/** crm.case.opened event payload (foreign producer — chain #5). */
type CrmCaseOpenedPayload = {
  caseId: string;
  subject?: string;
  description?: string | null;
  contactId?: string | null;
  dealId?: string | null;
};

function keyFor(tenantId: string, id: string) {
  return cache.makeKey(tenantId, RESOURCE, id);
}

export function registerTicketConsumers(rawQueue: Queue): void {
  // #146 regression fix: run every handler inside the message tenant context so
  // NOBYPASSRLS + FORCE RLS accepts consumer writes (telephony PR #152 pattern).
  const queue = tenantScoped(rawQueue);
  // ---- create -------------------------------------------------------------
  queue.subscribe<CreatePayload>(COMMANDS.createTicket, async (msg) => {
    const p = msg.payload;
    // LOOP 1 — cross-service escalate-to-ticket. knowledge-service's assistant
    // emits helpdesk.ticket.create with NO pre-assigned id/status, but a source
    // ("knowledge_assistant") + externalRef. Route it through the SAME idempotent
    // linked-insert path used for telephony/crm inbound linkage, keyed on
    // (tenant, source, source_ref=externalRef): redelivery yields exactly one
    // ticket, and (like the sibling hops) we emit ticketCreated only on first create.
    if (!p.id) {
      const source = p.source ?? SOURCE.assistant;
      const sourceRef = p.externalRef ?? msg.messageId;
      const subject = (p.subject ?? "").trim() || `Escalated request — ${sourceRef}`;
      let openedId: string | null = null;
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const { id, created } = await repo.insertLinkedIdempotent(tx, {
          tenantId: msg.tenantId,
          subject,
          description: p.description ?? null,
          priority: p.priority ?? "Medium",
          status: "open",
          source,
          sourceRef,
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
          version: 1,
        });
        openedId = id;
        if (created) {
          await emit(tx, msg, EVENTS.ticketCreated, { ticketId: id, subject, source, sourceRef }, "create", id);
        }
      });
      if (openedId) {
        const row = await repo.findById(openedId, msg.tenantId);
        if (row) await cache.put(keyFor(msg.tenantId, openedId), row);
        await cache.invalidateResource(msg.tenantId, RESOURCE);
      }
      return;
    }
    // Internal intake path (API-originated create command with a full payload).
    const ticketId = p.id; // narrowed to string by the guard above
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx, {
        id: ticketId,
        tenantId: p.tenantId ?? msg.tenantId,
        subject: p.subject,
        description: p.description ?? null,
        priority: p.priority ?? "Medium",
        status: p.status ?? "open",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
        ticketType: p.ticketType ?? null,
        typeFields: p.typeFields ?? null,
        assetIds: p.assetIds ?? null,
        assetVerified: p.assetVerified ?? false,
      });
      await emit(tx, msg, EVENTS.ticketCreated, { ticketId, subject: p.subject, ticketType: p.ticketType ?? null }, "create", ticketId);
    });
    const row = await repo.findById(ticketId, msg.tenantId);
    if (row) await cache.put(keyFor(msg.tenantId, ticketId), row);
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });

  // ---- ITIL: transition status --------------------------------------------
  queue.subscribe<TransitionPayload>(COMMANDS.transitionTicket, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const p = msg.payload;
      const updated = await repo.transitionStatus(tx, p.id, p.tenantId, p.newStatus, msg.actorId, new Date());
      if (!updated) {
        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { service: "helpdesk", action: "transition", resourceType: "ticket", resourceId: p.id, outcome: "rejected_not_found" },
        });
        return;
      }
      await emit(tx, msg, EVENTS.ticketTransitioned, { ticketId: p.id, newStatus: p.newStatus }, "transition", p.id);
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

  // ---- Chain #5: inbound linkage — a CRM complaint/case auto-opens a ticket --
  // Same idempotent path as the telephony hop, keyed on
  // (tenant, source=crm, source_ref=caseId): redelivery yields exactly one ticket.
  queue.subscribe<CrmCaseOpenedPayload>(CONSUMES.crmCaseOpened, async (msg) => {
    const caseId = msg.payload.caseId;
    if (!caseId) return; // malformed event — nothing to link
    const subject = msg.payload.subject?.trim() || `CRM case — ${caseId}`;
    let openedId: string | null = null;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const { id, created } = await repo.insertLinkedIdempotent(tx, {
        tenantId: msg.tenantId,
        subject,
        description: msg.payload.description ?? `Auto-opened from crm.case.opened for case ${caseId}.`,
        priority: "High",
        status: "open",
        source: SOURCE.crm,
        sourceRef: caseId,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      openedId = id;
      if (created) {
        await emit(tx, msg, EVENTS.ticketCreated, { ticketId: id, subject, source: SOURCE.crm, sourceRef: caseId }, "create", id);
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

// P1-③: Auto-create helpdesk ticket from citizen service request

export function registerCitizenRequestConsumer(rawQueue: Queue): void {
  // #146 regression fix: run every handler inside the message tenant context so
  // NOBYPASSRLS + FORCE RLS accepts consumer writes (telephony PR #152 pattern).
  const q = tenantScoped(rawQueue);
  q.subscribe(CONSUMES.citizenRequestCreated, async (msg) => {
    const p = msg.payload as { requestId: string; subject?: string; citizenId?: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const id = randomUUID();
      await tx.insert(tickets).values({
        id,
        tenantId: p.tenantId,
        subject: p.subject ?? "Citizen Service Request",
        createdBy: p.citizenId ?? msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, { topic: EVENTS.ticketCreated, eventType: EVENTS.ticketCreated, tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { ticketId: id, source: "citizen", requestId: p.requestId } });
    });
  });
}
