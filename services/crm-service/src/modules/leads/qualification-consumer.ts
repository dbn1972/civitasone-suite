/**
 * LQ-001 consumer — persist a lead qualification result and emit audit + event.
 * Idempotent via markProcessed; the insert carries the route-allocated id so a
 * redelivery cannot create a second qualification row for the same submission.
 */
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import type { RequestContext } from "@civitasone/types";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { emitWithAudit } from "../../shared/route-audit.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./qualification-repo.js";

const log = pino({ name: "crm-qualification-consumer" });
const RESOURCE = "lead_qualification";

export interface QualifyPayload {
  qualificationId: string;
  tenantId: string;
  leadId: string;
  frameworkId: string;
  answers: Record<string, unknown>;
  outcome: string;
  score: number;
  factors: Record<string, number>;
}

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }): RequestContext {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId } as RequestContext;
}

export function registerQualificationConsumer(queue: Queue): void {
  queue.subscribe<QualifyPayload>(COMMANDS.qualifyLead, async (msg) => {
    const p = msg.payload;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.insertLeadQualification(tx as typeof db, {
          id: p.qualificationId,
          tenantId: p.tenantId,
          leadId: p.leadId,
          frameworkId: p.frameworkId,
          answers: p.answers,
          outcome: p.outcome,
          score: p.score,
          qualifiedBy: msg.actorId,
        });
        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.leadQualified,
          action: "qualify",
          resourceType: RESOURCE,
          resourceId: p.qualificationId,
          payload: {
            qualificationId: p.qualificationId,
            leadId: p.leadId,
            frameworkId: p.frameworkId,
            outcome: p.outcome,
            score: p.score,
          },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "qualifyLead failed");
      throw err;
    }
  });
}
