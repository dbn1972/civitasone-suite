import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, CONSUMES, SOURCE, RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import { findSimilarTickets } from "./duplicate-detection.js";
import { randomUUID } from "node:crypto";
import { tickets } from "./schema.js";
import { allocateTicketNo } from "../../shared/numbering.js";
import { slaPolicies } from "../sla/schema.js";
import { eq, and } from "drizzle-orm";

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
  // CS-001 — multi-channel case creation fields.
  channel?: string | null;
  categoryId?: string | null;
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

/** notification.inbox.convert_to_ticket command payload (foreign producer — notification-service inbox). */
type ConvertInboxToTicketPayload = {
  id: string;
  tenantId: string;
  conversationId: string;
  subject: string;
  priority?: "low" | "medium" | "high" | "urgent";
  category?: string;
};

/** notification-service's "low|medium|high|urgent" onto helpdesk's "Low|Medium|High|Critical". */
function mapInboxPriority(priority: ConvertInboxToTicketPayload["priority"]): string {
  switch (priority) {
    case "low": return "Low";
    case "medium": return "Medium";
    case "high": return "High";
    case "urgent": return "Critical";
    default: return "Medium";
  }
}

/** TKT-04 — helpdesk.ticket.add_note payload. */
type AddNotePayload = {
  id: string;
  tenantId: string;
  ticketId: string;
  content: string;
  visibility: "internal" | "public";
  createdBy: string;
};

/** TKT-07 — helpdesk.ticket.transfer payload. */
type TransferPayload = {
  id: string;
  tenantId: string;
  ticketId: string;
  toDepartment: string;
  reason: string;
  transferredBy: string;
};

/** TKT-08 — helpdesk.ticket.link payload. */
type LinkPayload = {
  id: string;
  tenantId: string;
  sourceTicketId: string;
  targetTicketId: string;
  linkType: "parent" | "child" | "duplicate" | "related";
  createdBy: string;
};

/** TKT-09 — helpdesk.ticket.bulk_action payload (one message per ticket in the batch). */
type BulkActionPayload = {
  batchId: string;
  ticketId: string;
  action: "assign" | "close" | "set_priority";
  payload: Record<string, unknown>;
};

/** TKT-14 — helpdesk.ticket.reopen payload. */
type ReopenPayload = {
  id: string;
  tenantId: string;
  ticketId: string;
  reason: string;
};

function keyFor(tenantId: string, id: string) {
  return cache.makeKey(tenantId, RESOURCE, id);
}

/**
 * CS-001 — auto-assign SLA policy by matching priority + category.
 * Returns the first matching policy id, or null if no policy matches.
 * Priority match is mandatory; category match is optional (null category in
 * the policy means "any category").
 */
async function findMatchingSlaPolicy(
  tx: Parameters<typeof enqueue>[0],
  tenantId: string,
  priority: string,
  categoryId: string | null | undefined,
): Promise<string | null> {
  try {
    const rows = await (tx as unknown as typeof db).select()
      .from(slaPolicies)
      .where(and(
        eq(slaPolicies.tenantId, tenantId),
        eq(slaPolicies.priority, priority),
      ));
    // First match wins: prefer exact category match, then null-category (wildcard)
    const exactMatch = categoryId
      ? rows.find((r) => r.category === categoryId)
      : null;
    if (exactMatch) return exactMatch.id;
    const wildcardMatch = rows.find((r) => r.category === null || r.category === undefined);
    if (wildcardMatch) return wildcardMatch.id;
    return null;
  } catch {
    // Table may not exist yet or RLS issue — return null gracefully
    return null;
  }
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
      // CS-001: allocate gapless ticket reference number
      const ticketNo = await allocateTicketNo(tx as unknown as import("@civitasone/numbering").SqlExecutor, msg.tenantId);
      // CS-001: auto-assign SLA policy based on priority + category
      const slaPolicyId = await findMatchingSlaPolicy(
        tx as Parameters<typeof enqueue>[0],
        msg.tenantId,
        p.priority ?? "Medium",
        p.categoryId,
      );
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
        channel: p.channel ?? null,
        categoryId: p.categoryId ?? null,
        ticketNo,
        slaPolicyId,
      });
      await emit(tx, msg, EVENTS.ticketCreated, { ticketId, subject: p.subject, ticketType: p.ticketType ?? null, ticketNo, channel: p.channel ?? null }, "create", ticketId);
    });
    const row = await repo.findById(ticketId, msg.tenantId);
    if (row) await cache.put(keyFor(msg.tenantId, ticketId), row);
    await cache.invalidateResource(msg.tenantId, RESOURCE);

    // GRV-004: fire-and-forget duplicate detection (async, non-blocking)
    if (p.description) {
      rawQueue.publish(COMMANDS.detectDuplicates, {
        messageId: randomUUID(),
        type: COMMANDS.detectDuplicates,
        tenantId: msg.tenantId,
        actorId: "system",
        correlationId: msg.correlationId,
        schemaVersion: "1.0",
        payload: { ticketId, description: p.description, tenantId: msg.tenantId },
      }).catch(() => {});
    }
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
      await emit(tx, msg, EVENTS.ticketUpdated, { ticketId: p.id, changedFields: ["status"], newStatus: p.newStatus }, "update", p.id);
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
      await emit(tx, msg, EVENTS.ticketUpdated, { ticketId: p.id, changedFields: ["assigneeId"], assigneeId: p.assigneeId }, "update", p.id);
    });
    const row = await repo.findById(msg.payload.id, msg.tenantId);
    if (row) await cache.put(keyFor(msg.tenantId, msg.payload.id), row);
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });

  // ---- TKT-04: add note ----------------------------------------------------
  // Idempotent two ways: markProcessed dedupes on messageId (the route reuses
  // the note's own id as messageId, mirroring the sibling create/assign
  // pattern), and insertNoteIdempotent's onConflictDoNothing is the DB-level
  // backstop if the same note id is ever redelivered outside markProcessed.
  queue.subscribe<AddNotePayload>(COMMANDS.addNote, async (msg) => {
    const p = msg.payload;
    let inserted = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await repo.insertNoteIdempotent(tx, {
        id: p.id,
        tenantId: p.tenantId,
        ticketId: p.ticketId,
        content: p.content,
        visibility: p.visibility,
        createdBy: p.createdBy,
      });
      inserted = row !== null;
      await emit(tx, msg, EVENTS.noteAdded, { ticketId: p.ticketId, noteId: p.id, visibility: p.visibility }, "add_note", p.ticketId);
    });
    if (inserted) {
      await cache.invalidateResource(msg.tenantId, "ticket_notes");
    }
  });

  // ---- TKT-07: transfer ticket ----------------------------------------------
  // Records an audit-trail row (fromDepartment is derived from the most recent
  // prior transfer, or null for a ticket's first transfer). helpdesk.tickets
  // has no department/queue column, so there is nothing on the ticket row
  // itself to reassign — the transfer's system of record IS ticket_transfers.
  queue.subscribe<TransferPayload>(COMMANDS.transferTicket, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const fromDepartment = await repo.getCurrentDepartment(tx, p.tenantId, p.ticketId);
      const row = await repo.insertTransferIdempotent(tx, {
        id: p.id,
        tenantId: p.tenantId,
        ticketId: p.ticketId,
        fromDepartment,
        toDepartment: p.toDepartment,
        reason: p.reason,
        transferredBy: p.transferredBy,
      });
      if (!row) return; // duplicate delivery of the same transfer id — no-op
      await emit(tx, msg, EVENTS.ticketTransferred, { ticketId: p.ticketId, fromDepartment, toDepartment: p.toDepartment }, "transfer", p.ticketId);
    });
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });

  // ---- TKT-08: link tickets --------------------------------------------------
  // Symmetric-safe: insertLinkIdempotent treats "A parent-of B" as covering
  // "B child-of A" and treats duplicate/related as order-independent, so
  // redelivery — or the same relationship reported in reverse — never inserts
  // a second row.
  queue.subscribe<LinkPayload>(COMMANDS.linkTickets, async (msg) => {
    const p = msg.payload;
    let linkId: string | null = null;
    let created = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const res = await repo.insertLinkIdempotent(tx, {
        id: p.id,
        tenantId: p.tenantId,
        sourceTicketId: p.sourceTicketId,
        targetTicketId: p.targetTicketId,
        linkType: p.linkType,
        createdBy: p.createdBy,
      });
      linkId = res.id;
      created = res.created;
      if (created) {
        await emit(tx, msg, EVENTS.ticketsLinked, { linkId: res.id, sourceTicketId: p.sourceTicketId, targetTicketId: p.targetTicketId, linkType: p.linkType }, "link", res.id);
      }
    });
    if (linkId && created) {
      await cache.invalidateResource(msg.tenantId, "ticket_links");
    }
  });

  // ---- TKT-09: bulk action ---------------------------------------------------
  // The route fans a batch out to one message PER ticket (each with its own
  // messageId), so per-item failure isolation and idempotency are inherited
  // from the same markProcessed + per-ticket-update mechanism the single-ticket
  // assign/transition/priority paths already use — no separate batching logic
  // needed here, and one poison ticketId can't lose the rest of the batch.
  queue.subscribe<BulkActionPayload>(COMMANDS.bulkAction, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const now = new Date();
      let updated: Awaited<ReturnType<typeof repo.assign>> = null;
      // Missing-field rejection uses the SAME audited path as not-found below
      // (rather than a bare `return`) so a malformed batch item is observable
      // in the audit trail instead of silently vanishing.
      let rejectReason: string | null = null;
      if (p.action === "assign") {
        const assigneeId = p.payload?.assigneeId as string | undefined;
        if (!assigneeId) {
          rejectReason = "rejected_missing_assignee";
        } else {
          updated = await repo.assign(tx, p.ticketId, msg.tenantId, assigneeId, msg.actorId, now);
        }
      } else if (p.action === "close") {
        updated = await repo.transitionStatus(tx, p.ticketId, msg.tenantId, "closed", msg.actorId, now);
      } else if (p.action === "set_priority") {
        const priority = p.payload?.priority as string | undefined;
        if (!priority) {
          rejectReason = "rejected_missing_priority";
        } else {
          updated = await repo.updatePriority(tx, p.ticketId, msg.tenantId, priority, msg.actorId, now);
        }
      }
      if (!updated) {
        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { service: "helpdesk", action: "bulk_action", resourceType: "ticket", resourceId: p.ticketId, outcome: rejectReason ?? "rejected_not_found", batchId: p.batchId },
        });
        return;
      }
      await emit(tx, msg, EVENTS.ticketUpdated, { ticketId: p.ticketId, changedFields: [p.action], batchId: p.batchId }, "bulk_action", p.ticketId);
    });
    const row = await repo.findById(p.ticketId, msg.tenantId);
    if (row) await cache.put(keyFor(msg.tenantId, p.ticketId), row);
    await cache.invalidateResource(msg.tenantId, RESOURCE);
  });

  // ---- TKT-14: reopen ticket -------------------------------------------------
  // reopenIfClosed's WHERE clause guards on current status = resolved/closed in
  // the same UPDATE, so a redelivery (or a reopen request racing an already-open
  // ticket) is a clean no-op instead of double-transitioning or erroring.
  queue.subscribe<ReopenPayload>(COMMANDS.reopenTicket, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const updated = await repo.reopenIfClosed(tx, p.ticketId, p.tenantId, msg.actorId, new Date());
      if (!updated) {
        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { service: "helpdesk", action: "reopen", resourceType: "ticket", resourceId: p.ticketId, outcome: "rejected_not_resolved_or_closed" },
        });
        return;
      }
      await emit(tx, msg, EVENTS.ticketReopened, { ticketId: p.ticketId, reason: p.reason }, "reopen", p.ticketId);
      await emit(tx, msg, EVENTS.ticketUpdated, { ticketId: p.ticketId, changedFields: ["status"], newStatus: "open" }, "update", p.ticketId);
    });
    const row = await repo.findById(p.ticketId, msg.tenantId);
    if (row) await cache.put(keyFor(msg.tenantId, p.ticketId), row);
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

  // ---- notification.inbox.convert_to_ticket: inbox conversation -> ticket --
  // notification-service's inbox "convert to ticket" action published this
  // command with NOTHING consuming it — the POST on
  // /v1/notification/inbox/:conversationId/convert-to-ticket always returned
  // 202 but no ticket was ever created. Consumed here (helpdesk owns tickets),
  // mirroring the same idempotent linked-insert path used for the
  // telephony/crm/citizen inbound hops above: keyed on
  // (tenant, source="email/inbox", source_ref=conversationId), so a redelivery
  // of the same convert command yields exactly one ticket. category has no
  // dedicated column on helpdesk.tickets, so it is preserved in typeFields.
  queue.subscribe<ConvertInboxToTicketPayload>(CONSUMES.notificationInboxConvertToTicket, async (msg) => {
    const p = msg.payload;
    if (!p.conversationId || !p.subject) return; // malformed payload — nothing to convert
    let openedId: string | null = null;
    let created = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const res = await repo.insertLinkedIdempotent(tx, {
        tenantId: msg.tenantId,
        subject: p.subject,
        description: `Converted from inbox conversation ${p.conversationId}.`,
        priority: mapInboxPriority(p.priority),
        status: "open",
        source: SOURCE.emailInbox,
        sourceRef: p.conversationId,
        typeFields: p.category ? { category: p.category } : null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
        version: 1,
      });
      openedId = res.id;
      created = res.created;
      if (created) {
        await emit(tx, msg, EVENTS.ticketCreated, { ticketId: res.id, subject: p.subject, source: SOURCE.emailInbox, sourceRef: p.conversationId }, "create", res.id);
      }
    });
    if (openedId) {
      const row = await repo.findById(openedId, msg.tenantId);
      if (row) await cache.put(keyFor(msg.tenantId, openedId), row);
      await cache.invalidateResource(msg.tenantId, RESOURCE);
    }
  });

  // ---- GRV-004: detect duplicate tickets -----------------------------------
  queue.subscribe<{ ticketId: string; description: string; tenantId: string }>(COMMANDS.detectDuplicates, async (msg) => {
    const p = msg.payload;
    const recentTickets = await repo.listByTenant(p.tenantId, 100, 0);
    const candidates = recentTickets
      .filter((t) => t.id !== p.ticketId && t.status !== "closed")
      .map((t) => ({ id: t.id, subject: t.subject ?? "", description: (t as unknown as { description?: string }).description ?? t.subject ?? "" }));

    if (candidates.length === 0) return;

    const similar = findSimilarTickets(p.description, candidates);
    if (similar.length === 0) return;

    // Auto-create "related" links for agent review
    for (const s of similar) {
      const linkId = randomUUID();
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, `dedup-${p.ticketId}-${s.ticketId}`))) return;
        await enqueue(tx, {
          topic: COMMANDS.linkTickets,
          eventType: COMMANDS.linkTickets,
          tenantId: p.tenantId,
          actorId: "system",
          correlationId: msg.correlationId,
          payload: {
            id: linkId,
            tenantId: p.tenantId,
            sourceTicketId: p.ticketId,
            targetTicketId: s.ticketId,
            linkType: "related",
            createdBy: "system",
            autoDetected: true,
            similarity: s.similarity,
          },
        });
      });
    }

    await cache.invalidateResource(p.tenantId, "ticket_links");
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
