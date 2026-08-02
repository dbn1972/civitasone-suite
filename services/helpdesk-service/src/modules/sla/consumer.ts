import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { eq, and, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { tickets } from "../tickets/schema.js";
import { ticketEscalations, slaPolicies, csatResponses } from "./schema.js";

const log = pino({ name: "helpdesk.sla.consumer" });
const AUDIT = "audit.event.record";

async function audit(
  tx: Parameters<typeof enqueue>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string,
  resourceType: string,
  resourceId: string,
) {
  await enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "helpdesk", action, resourceType, resourceId, outcome: "success" },
  });
}

export function registerSlaConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.slaPolicyUpsert, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; priority: string; category?: string | null;
      responseMinutes: number; resolutionMinutes: number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const [existing] = await tx.select().from(slaPolicies).where(
        and(
          eq(slaPolicies.tenantId, p.tenantId),
          eq(slaPolicies.priority, p.priority),
          p.category
            ? eq(slaPolicies.category, p.category)
            : sql`${slaPolicies.category} IS NULL`,
        ),
      ).limit(1);

      if (existing) {
        await tx.update(slaPolicies).set({
          responseMinutes: p.responseMinutes,
          resolutionMinutes: p.resolutionMinutes,
          updatedBy: msg.actorId,
          updatedAt: new Date(),
          version: sql`${slaPolicies.version} + 1`,
        }).where(eq(slaPolicies.id, existing.id));
        await audit(tx, msg, "sla_policy_update", "sla_policy", existing.id);
      } else {
        await tx.insert(slaPolicies).values({
          id: p.id,
          tenantId: p.tenantId,
          priority: p.priority,
          category: p.category ?? null,
          responseMinutes: p.responseMinutes,
          resolutionMinutes: p.resolutionMinutes,
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });
        await audit(tx, msg, "sla_policy_create", "sla_policy", p.id);
      }
    });
    log.info({ id: p.id }, "sla policy upserted");
  });

  queue.subscribe(COMMANDS.csatSubmit, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; ticketId: string; rating: number; comment?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const [ticket] = await tx.select().from(tickets).where(
        and(eq(tickets.id, p.ticketId), eq(tickets.tenantId, p.tenantId)),
      ).limit(1);
      if (!ticket || (ticket.status !== "resolved" && ticket.status !== "closed")) return;
      const [existing] = await tx.select().from(csatResponses)
        .where(eq(csatResponses.ticketId, p.ticketId)).limit(1);
      if (existing) return;
      await tx.insert(csatResponses).values({
        id: p.id,
        tenantId: p.tenantId,
        ticketId: p.ticketId,
        rating: p.rating,
        comment: p.comment ?? null,
        createdBy: msg.actorId,
      });
      await audit(tx, msg, "csat_submit", "csat", p.id);
    });
  });

  queue.subscribe(COMMANDS.ticketEscalate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; ticketId: string; reason: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const [ticket] = await tx.select().from(tickets).where(
        and(eq(tickets.id, p.ticketId), eq(tickets.tenantId, p.tenantId)),
      ).limit(1);
      if (!ticket) return;
      const [countRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(ticketEscalations)
        .where(and(eq(ticketEscalations.tenantId, p.tenantId), eq(ticketEscalations.ticketId, p.ticketId)));
      const level = (countRow?.count ?? 0) + 1;
      await tx.insert(ticketEscalations).values({
        id: p.id,
        tenantId: p.tenantId,
        ticketId: p.ticketId,
        escalatedBy: msg.actorId,
        reason: p.reason,
        level,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await tx.update(tickets).set({ priority: "High", updatedAt: new Date() })
        .where(eq(tickets.id, p.ticketId));
      await enqueue(tx, {
        topic: EVENTS.ticketEscalated, eventType: EVENTS.ticketEscalated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { ticketId: p.ticketId, level, reason: p.reason },
      });
      await audit(tx, msg, "ticket_escalate", "ticket", p.ticketId);
    });
  });
}
