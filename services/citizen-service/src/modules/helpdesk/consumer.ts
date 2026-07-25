import type { Queue } from "@civitasone/queue";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { computeSlaDueAt, computeSlaStatus } from "./sla.js";
import type { TicketRow } from "./schema.js";

export function registerHelpdeskConsumers(rawQueue: Queue): void {
  // #146 NOBYPASSRLS: every handler must run inside the message's tenant
  // context so wrapWithTenantGuc sets app.tenant_id (RLS) in db.transaction().
  const queue = tenantScoped(rawQueue);
  queue.subscribe(COMMANDS.ticketCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; citizenId: string; subject: string; description: string;
      ticketNo?: string; priority?: string; category?: string; channel?: string;
    };
    const priority = p.priority ?? "medium";
    const createdAt = new Date();
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertTicket(tx, {
        id: p.id, tenantId: p.tenantId, citizenId: p.citizenId,
        ticketNo: p.ticketNo ?? `HD-${p.id.slice(0, 8).toUpperCase()}`,
        subject: p.subject, description: p.description, status: "open",
        priority, category: p.category ?? "general", channel: p.channel ?? "web",
        slaDueAt: computeSlaDueAt(priority, createdAt),
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "citizen_ticket", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "ticket", p.id));
  });

  queue.subscribe(COMMANDS.ticketNote, async (msg) => {
    const p = msg.payload as { id: string; ticketId: string; tenantId: string; body: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertNote(tx, {
        id: p.id, tenantId: p.tenantId, ticketId: p.ticketId,
        authorId: msg.actorId, body: p.body,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "note", "citizen_ticket", p.ticketId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "ticket", p.ticketId));
  });

  queue.subscribe(COMMANDS.ticketClose, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; note?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ticket = await repo.findTicketByIdTx(tx, p.id, msg.tenantId);
      if (!ticket) return;
      // P1: state guard — closing an already-closed ticket is a no-op (no
      // duplicate audit entry / note). Terminal state is immutable.
      if (ticket.status === "closed") return;
      await repo.updateTicket(tx, p.id, msg.tenantId, { status: "closed", updatedBy: msg.actorId });
      if (p.note) {
        await repo.insertNote(tx, {
          tenantId: p.tenantId, ticketId: p.id, authorId: msg.actorId, body: p.note,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
      }
      await audit(tx, msg, "close", "citizen_ticket", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "ticket", p.id));
  });

  queue.subscribe(COMMANDS.ticketAssign, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; assigneeId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId ?? p.id))) return;
      const ticket = await repo.findTicketByIdTx(tx, p.id, msg.tenantId);
      if (!ticket) return;
      await repo.updateTicket(tx, p.id, msg.tenantId, {
        assigneeId: p.assigneeId,
        status: ticket.status === "open" ? "in_progress" : ticket.status,
        updatedBy: msg.actorId,
      });
      await notifyIfBreached(tx, msg, ticket);
      await audit(tx, msg, "assign", "citizen_ticket", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "ticket", p.id));
  });

  queue.subscribe(COMMANDS.ticketResolve, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; note?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId ?? p.id))) return;
      const ticket = await repo.findTicketByIdTx(tx, p.id, msg.tenantId);
      if (!ticket) return;
      // P1: state guard — a closed ticket is terminal and cannot be reopened to
      // "resolved"; re-resolving an already-resolved ticket is a no-op so the
      // original resolvedAt timestamp is preserved.
      if (ticket.status === "closed" || ticket.status === "resolved") return;
      await repo.updateTicket(tx, p.id, msg.tenantId, {
        status: "resolved",
        resolvedAt: new Date(),
        updatedBy: msg.actorId,
      });
      if (p.note) {
        await repo.insertNote(tx, {
          tenantId: p.tenantId, ticketId: p.id, authorId: msg.actorId, body: p.note,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
      }
      await audit(tx, msg, "resolve", "citizen_ticket", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "ticket", p.id));
  });

  queue.subscribe(COMMANDS.ticketEscalate, async (msg) => {
    const p = msg.payload as { id: string; ticketId: string; tenantId: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ticket = await repo.findTicketByIdTx(tx, p.ticketId, msg.tenantId);
      if (!ticket) return;
      const level = (await repo.countEscalationsForTicket(p.tenantId, p.ticketId)) + 1;
      await repo.insertEscalation(tx, {
        id: p.id,
        tenantId: p.tenantId,
        ticketId: p.ticketId,
        escalatedBy: msg.actorId,
        reason: p.reason,
        level,
      });
      await repo.updateTicket(tx, p.ticketId, msg.tenantId, { priority: "high", updatedBy: msg.actorId });
      await notifyIfBreached(tx, msg, ticket);
      await audit(tx, msg, "escalate", "citizen_ticket", p.ticketId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "ticket", p.ticketId));
  });

  /**
   * P0-2: SLA sweep tick for tickets. Published by the scheduler with a
   * deterministic messageId so a given overdue ticket only breaches once.
   * Re-validates the SLA inside the tx, records an escalation, bumps priority,
   * and emits the breach notification.
   */
  queue.subscribe(COMMANDS.ticketSlaCheck, async (msg) => {
    const p = msg.payload as { tenantId: string; ticketId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const ticket = await repo.findTicketByIdTx(tx, p.ticketId, msg.tenantId);
      if (!ticket) return;
      if (computeSlaStatus(ticket) !== "breached") return;
      if (ticket.status === "closed" || ticket.status === "resolved") return;
      const level = (await repo.countEscalationsForTicket(p.tenantId, p.ticketId)) + 1;
      await repo.insertEscalation(tx, {
        tenantId: p.tenantId, ticketId: p.ticketId, escalatedBy: msg.actorId,
        reason: "auto_escalation: SLA breached", level,
      });
      await repo.updateTicket(tx, p.ticketId, msg.tenantId, { priority: "high", updatedBy: msg.actorId });
      await notifyIfBreached(tx, msg, ticket);
      await audit(tx, msg, "sla_breached", "citizen_ticket", p.ticketId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "ticket", p.ticketId));
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: "audit.event.record", eventType: "audit.event.record",
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "citizen", action, resourceType, resourceId, outcome: "success" },
  });
}

/**
 * Emit notification.send when a ticket's recomputed SLA status is breached.
 * Called on existing lifecycle events (assign/escalate) — no separate scheduler.
 * markProcessed wraps each command, so redelivery stays idempotent.
 */
async function notifyIfBreached(tx: any, msg: any, ticket: TicketRow): Promise<void> {
  if (computeSlaStatus(ticket) !== "breached") return;
  await enqueue(tx, {
    topic: NOTIFICATION_SEND, eventType: NOTIFICATION_SEND,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: buildNotificationPayload({
      eventType: EVENTS.ticketSlaBreached,
      recipient: ticket.assigneeId ?? ticket.citizenId,
      recipientId: ticket.assigneeId ?? ticket.citizenId,
      variables: {
        ticketId: ticket.id,
        ticketNo: ticket.ticketNo ?? ticket.id,
        priority: ticket.priority,
        summary: `Ticket SLA breached: ${ticket.subject}`,
        link: `/helpdesk/tickets/${ticket.id}`,
      },
    }),
  });
}
