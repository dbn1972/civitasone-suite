import { pino } from "pino";
import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { eq, and, sql, isNull, gte } from "drizzle-orm";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { isCsatDetractor } from "./domain.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { tickets } from "../tickets/schema.js";
import { ticketEscalations, slaPolicies, csatResponses } from "./schema.js";
import { businessCalendars, type WorkDay, type Holiday } from "./calendar-schema.js";
import { slaPauses } from "./pause-schema.js";
import { slaExtensions } from "./extensions-schema.js";
import { cesResponses } from "./ces-schema.js";

const log = pino({ name: "helpdesk.sla.consumer" });
const AUDIT = "audit.event.record";
/** System actor for helpdesk-initiated actions (mirrors the CSAT/SLA sweepers). */
const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-0000000000d1";

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
      await enqueue(tx, {
        topic: EVENTS.csatSubmitted, eventType: EVENTS.csatSubmitted,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { csatId: p.id, ticketId: p.ticketId, rating: p.rating },
      });
      await audit(tx, msg, "csat_submit", "csat", p.id);

      if (!isCsatDetractor(p.rating)) return;

      // Service recovery: a detractor rating reopens the loop with the owning
      // agent as a tracked escalation, so it lands in the escalation register
      // alongside SLA breaches instead of dying as a statistic.
      const [levelRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(ticketEscalations)
        .where(and(eq(ticketEscalations.tenantId, p.tenantId), eq(ticketEscalations.ticketId, p.ticketId)));
      const recoveryId = randomUUID();
      await tx.insert(ticketEscalations).values({
        id: recoveryId,
        tenantId: p.tenantId,
        ticketId: p.ticketId,
        escalatedBy: SYSTEM_ACTOR_ID,
        reason: `service recovery: CSAT rating ${p.rating}`,
        level: (levelRow?.count ?? 0) + 1,
        createdBy: SYSTEM_ACTOR_ID,
        updatedBy: SYSTEM_ACTOR_ID,
      });
      const owner = ticket.assigneeId ?? ticket.createdBy;
      await enqueue(tx, {
        topic: EVENTS.csatServiceRecovery, eventType: EVENTS.csatServiceRecovery,
        tenantId: msg.tenantId, actorId: SYSTEM_ACTOR_ID, correlationId: msg.correlationId,
        payload: {
          csatId: p.id, ticketId: p.ticketId, rating: p.rating,
          escalationId: recoveryId, owner,
        },
      });
      await enqueue(tx, {
        topic: NOTIFICATION_SEND, eventType: NOTIFICATION_SEND,
        tenantId: msg.tenantId, actorId: SYSTEM_ACTOR_ID, correlationId: msg.correlationId,
        payload: buildNotificationPayload({
          eventType: EVENTS.csatServiceRecovery,
          recipient: owner,
          variables: {
            ticketId: p.ticketId,
            rating: String(p.rating),
            summary: `Service recovery needed — CSAT ${p.rating}/5 on: ${ticket.subject}`,
            link: `/helpdesk/tickets/${p.ticketId}`,
          },
        }),
      });
      await audit(tx, { ...msg, actorId: SYSTEM_ACTOR_ID }, "csat_service_recovery", "ticket", p.ticketId);
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

  queue.subscribe(COMMANDS.calendarCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; name: string; timezone: string;
      workDays: WorkDay[]; holidays: Holiday[];
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.insert(businessCalendars).values({
        id: p.id,
        tenantId: p.tenantId,
        name: p.name,
        timezone: p.timezone,
        workDays: p.workDays,
        holidays: p.holidays,
      });
      await audit(tx, msg, "calendar_create", "business_calendar", p.id);
    });
  });

  queue.subscribe(COMMANDS.calendarUpdate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; name?: string; timezone?: string;
      workDays?: WorkDay[]; holidays?: Holiday[]; expectedVersion: number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const [existing] = await tx.select().from(businessCalendars)
        .where(and(eq(businessCalendars.id, p.id), eq(businessCalendars.tenantId, p.tenantId)))
        .limit(1);
      if (!existing || existing.version !== p.expectedVersion) return;
      await tx.update(businessCalendars).set({
        ...(p.name !== undefined && { name: p.name }),
        ...(p.timezone !== undefined && { timezone: p.timezone }),
        ...(p.workDays !== undefined && { workDays: p.workDays }),
        ...(p.holidays !== undefined && { holidays: p.holidays }),
        version: sql`${businessCalendars.version} + 1`,
      }).where(and(eq(businessCalendars.id, p.id), eq(businessCalendars.version, existing.version)));
      await audit(tx, msg, "calendar_update", "business_calendar", p.id);
    });
  });

  queue.subscribe(COMMANDS.slaPause, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; ticketId: string; pauseStatus: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const [ticket] = await tx.select().from(tickets)
        .where(and(eq(tickets.id, p.ticketId), eq(tickets.tenantId, p.tenantId))).limit(1);
      if (!ticket) return;
      const [activePause] = await tx.select().from(slaPauses).where(and(
        eq(slaPauses.ticketId, p.ticketId),
        eq(slaPauses.tenantId, p.tenantId),
        isNull(slaPauses.resumedAt),
      )).limit(1);
      if (activePause) return;
      await tx.insert(slaPauses).values({
        id: p.id,
        tenantId: p.tenantId,
        ticketId: p.ticketId,
        pauseStatus: p.pauseStatus,
        createdBy: msg.actorId,
      });
      await audit(tx, msg, "sla_pause", "ticket", p.ticketId);
    });
  });

  queue.subscribe(COMMANDS.slaResume, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; ticketId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const [activePause] = await tx.select().from(slaPauses).where(and(
        eq(slaPauses.ticketId, p.ticketId),
        eq(slaPauses.tenantId, p.tenantId),
        isNull(slaPauses.resumedAt),
      )).limit(1);
      if (!activePause) return;
      await tx.update(slaPauses)
        .set({ resumedAt: new Date(), version: sql`${slaPauses.version} + 1` })
        .where(eq(slaPauses.id, activePause.id));
      await audit(tx, msg, "sla_resume", "ticket", p.ticketId);
    });
  });

  queue.subscribe(COMMANDS.slaExtend, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; ticketId: string;
      additionalMinutes: number; reason: string; approverId: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const [ticket] = await tx.select().from(tickets)
        .where(and(eq(tickets.id, p.ticketId), eq(tickets.tenantId, p.tenantId))).limit(1);
      if (!ticket) return;
      await tx.insert(slaExtensions).values({
        id: p.id,
        tenantId: p.tenantId,
        ticketId: p.ticketId,
        additionalMinutes: p.additionalMinutes,
        reason: p.reason,
        approverId: p.approverId,
        createdBy: msg.actorId,
      });
      await audit(tx, msg, "sla_extend", "ticket", p.ticketId);
    });
  });

  queue.subscribe(COMMANDS.cesSubmit, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; ticketId: string; effortScore: number; comment?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const [ticket] = await tx.select().from(tickets)
        .where(and(eq(tickets.id, p.ticketId), eq(tickets.tenantId, p.tenantId))).limit(1);
      if (!ticket) return;
      const [existingForTicket] = await tx.select().from(cesResponses)
        .where(and(eq(cesResponses.ticketId, p.ticketId), eq(cesResponses.tenantId, p.tenantId)))
        .limit(1);
      if (existingForTicket) return;
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const [recent] = await tx.select({ count: sql<number>`count(*)::int` }).from(cesResponses).where(and(
        eq(cesResponses.createdBy, msg.actorId),
        eq(cesResponses.tenantId, p.tenantId),
        gte(cesResponses.submittedAt, thirtyDaysAgo),
      ));
      if ((recent?.count ?? 0) >= 3) return;
      await tx.insert(cesResponses).values({
        id: p.id,
        tenantId: p.tenantId,
        ticketId: p.ticketId,
        effortScore: p.effortScore,
        comment: p.comment ?? null,
        createdBy: msg.actorId,
      });
      await audit(tx, msg, "ces_submit", "ces", p.id);
    });
  });
}
