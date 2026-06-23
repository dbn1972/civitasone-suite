import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import { computeSlaDueAt } from "./sla.js";

export function registerHelpdeskConsumers(queue: Queue): void {
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
      const ticket = await repo.findTicketByIdTx(tx, p.id);
      if (!ticket) return;
      await repo.updateTicket(tx, p.id, { status: "closed", updatedBy: msg.actorId });
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
      const ticket = await repo.findTicketByIdTx(tx, p.id);
      if (!ticket) return;
      await repo.updateTicket(tx, p.id, {
        assigneeId: p.assigneeId,
        status: ticket.status === "open" ? "in_progress" : ticket.status,
        updatedBy: msg.actorId,
      });
      await audit(tx, msg, "assign", "citizen_ticket", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "ticket", p.id));
  });

  queue.subscribe(COMMANDS.ticketResolve, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; note?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId ?? p.id))) return;
      const ticket = await repo.findTicketByIdTx(tx, p.id);
      if (!ticket) return;
      await repo.updateTicket(tx, p.id, {
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
      const ticket = await repo.findTicketByIdTx(tx, p.ticketId);
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
      await repo.updateTicket(tx, p.ticketId, { priority: "high", updatedBy: msg.actorId });
      await audit(tx, msg, "escalate", "citizen_ticket", p.ticketId);
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
