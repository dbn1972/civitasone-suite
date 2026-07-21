/**
 * CSAT Survey Consumer — sends a CSAT survey notification to the ticket requester
 * within 15 minutes of ticket resolution.
 *
 * Listens for ticket transition events where the new status is "resolved" and
 * schedules a survey notification via the notification service.
 */
import { pino } from "pino";
import { randomUUID } from "node:crypto";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { tickets } from "../tickets/schema.js";
import { csatResponses } from "./schema.js";
import { eq, and } from "drizzle-orm";
import type { Queue } from "@civitasone/queue";
import { EVENTS } from "../../topics.js";
import { markProcessed } from "../../shared/outbox.js";

const log = pino({ name: "helpdesk-csat-consumer" });

const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-0000000000d1";
const CSAT_SURVEY_TOPIC = "helpdesk.csat.survey_request";

export interface TicketTransitionedPayload {
  ticketId: string;
  tenantId: string;
  newStatus: string;
  previousStatus: string;
  actorId: string;
}

/**
 * Schedule a CSAT survey notification for a resolved ticket.
 * Fires once — deduplication via checking if a csat_response already exists.
 */
export async function scheduleCsatSurvey(
  ticketId: string,
  tenantId: string,
): Promise<boolean> {
  // Check if ticket is resolved.
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const [ticket] = await db.transaction((tx) =>
    tx.select().from(tickets).where(
      and(eq(tickets.id, ticketId), eq(tickets.tenantId, tenantId)),
    ).limit(1),
  );

  if (!ticket) {
    log.warn({ ticketId, tenantId }, "csat: ticket not found");
    return false;
  }

  if (ticket.status !== "resolved" && ticket.status !== "closed") {
    log.debug({ ticketId, status: ticket.status }, "csat: ticket not resolved, skipping");
    return false;
  }

  // Check if CSAT already submitted (idempotency).
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const [existing] = await db.transaction((tx) =>
    tx.select().from(csatResponses).where(
      eq(csatResponses.ticketId, ticketId),
    ).limit(1),
  );

  if (existing) {
    log.debug({ ticketId }, "csat: already submitted, skipping");
    return false;
  }

  // Enqueue CSAT survey notification to the ticket creator
  const correlationId = randomUUID();
  await db.transaction(async (tx) => {
    const tx2 = tx as Parameters<typeof enqueue>[0];
    await enqueue(tx2, {
      topic: NOTIFICATION_SEND,
      eventType: NOTIFICATION_SEND,
      tenantId,
      actorId: SYSTEM_ACTOR_ID,
      correlationId,
      payload: buildNotificationPayload({
        eventType: CSAT_SURVEY_TOPIC,
        recipient: ticket.createdBy,
        variables: {
          ticketId: ticket.id,
          subject: ticket.subject,
          summary: `How satisfied were you with the resolution of: ${ticket.subject}?`,
          link: `/helpdesk/tickets/${ticket.id}/csat`,
        },
      }),
    });
  });

  log.info({ ticketId, tenantId, correlationId }, "csat: survey notification scheduled");
  return true;
}

/**
 * Register the CSAT consumer for ticket transition events.
 * When a ticket is resolved, schedule a CSAT survey within 15 minutes.
 */
export function registerCsatConsumer(queue: Queue): void {
  queue.subscribe(EVENTS.ticketTransitioned, async (msg) => {
    const payload = msg.payload as TicketTransitionedPayload;
    if (!payload || payload.newStatus !== "resolved") return;

    await db.transaction(async (tx) => {
      await markProcessed(tx as Parameters<typeof markProcessed>[0], msg.messageId);
    });

    await scheduleCsatSurvey(payload.ticketId, payload.tenantId ?? msg.tenantId);
  });
}
