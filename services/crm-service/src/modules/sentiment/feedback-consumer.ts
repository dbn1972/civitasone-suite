/**
 * GAP-CRM-VOICE-OF-CUSTOMER-FEEDBACK-05 — citizen feedback consumer.
 *
 * Idempotent (markProcessed), tenant-scoped. Inserts the citizen's rating +
 * optional comment and emits the recorded event + audit inside one transaction.
 * The comment (PII) is written to the row but NEVER placed on the event stream
 * or in a log line — the event carries only rating + serviceRequestId.
 */
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import type { RequestContext } from "@civitasone/types";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { emitWithAudit } from "../../shared/route-audit.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./feedback-repo.js";
import { invalidateFeedback } from "./feedback-queries.js";

const log = pino({ name: "crm-citizen-feedback-consumer" });

interface RecordPayload {
  id: string;
  tenantId: string;
  rating: number;
  comment: string | null;
  serviceRequestId: string | null;
  submissionType: string;
}

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }): RequestContext {
  return {
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
  } as RequestContext;
}

export function registerCitizenFeedbackConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.recordCitizenFeedback, async (msg) => {
    const p = msg.payload as RecordPayload;
    if (!p?.id) return;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        await repo.insert(tx, {
          id: p.id,
          tenantId: msg.tenantId,
          rating: p.rating,
          comment: p.comment ?? null,
          serviceRequestId: p.serviceRequestId ?? null,
          submissionType: p.submissionType || "anonymous",
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });

        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.citizenFeedbackRecorded,
          action: "record",
          resourceType: "citizen_feedback",
          resourceId: p.id,
          // No comment text on the event stream (DPDP data minimisation).
          payload: {
            feedbackId: p.id,
            rating: p.rating,
            serviceRequestId: p.serviceRequestId ?? null,
          },
        });
      });
    } catch (err) {
      // Deliberately NOT logging the payload — the comment is citizen PII.
      log.error({ err, messageId: msg.messageId }, "recordCitizenFeedback failed");
      throw err;
    }
    await invalidateFeedback(msg.tenantId);
  });
}
