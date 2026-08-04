/**
 * AC-003 communication-log consumer. Idempotent (markProcessed), tenant-scoped,
 * writes inside the caller's transaction, and emits a domain event + audit entry
 * in the same outbox — the established crm consumer shape.
 */
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";

const log = pino({ name: "crm-communications-consumer" });
const AUDIT = "audit.event.record";

interface CommunicationPayload {
  id: string;
  tenantId: string;
  subjectType: string;
  subjectId: string;
  direction: string;
  channel: string;
  outcome: string | null;
  disposition: string | null;
  summary: string | null;
  occurredAt: string;
}

export function registerCommunicationConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.createCommunication, async (msg) => {
    const p = msg.payload as CommunicationPayload;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.execute(sql`
          INSERT INTO crm.communications
            (id, tenant_id, subject_type, subject_id, direction, channel, outcome, disposition, summary, occurred_at, logged_by)
          VALUES
            (${p.id}, ${p.tenantId}, ${p.subjectType}, ${p.subjectId}, ${p.direction}, ${p.channel},
             ${p.outcome}, ${p.disposition}, ${p.summary}, ${p.occurredAt}, ${msg.actorId})
        `);
        await enqueue(tx, {
          topic: EVENTS.communicationLogged, eventType: EVENTS.communicationLogged,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            communicationId: p.id, subjectType: p.subjectType, subjectId: p.subjectId,
            direction: p.direction, channel: p.channel,
          },
        });
        await enqueue(tx, {
          topic: AUDIT, eventType: AUDIT,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { service: "crm", action: "communication_logged", resourceType: "communication", resourceId: p.id, outcome: "success" },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "createCommunication failed");
      throw err;
    }
  });
}
