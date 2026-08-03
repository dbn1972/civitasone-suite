/**
 * Voice-of-Customer consumer (P2-6).
 *
 * Scores an interaction's text and stores one reading per activity. The trigger is
 * a dedicated `crm.sentiment.analyse` command relayed from the activities module's
 * outbox, not a call into that module: sentiment never reads an activity row and
 * holds `activityId` only as an opaque reference, so it stays independently
 * extractable — and when scoring moves to ml-service, only this file changes.
 *
 * A dedicated command rather than a wider `crm.activity.created` payload keeps the
 * interaction text on exactly one topic instead of broadcasting it to every
 * consumer of activity events (DPDP data minimisation).
 *
 * Idempotency has two layers: `markProcessed` gates redelivery, and the insert is
 * ON CONFLICT DO NOTHING against (tenant_id, activity_id). Either alone would do
 * for the common case; together they mean a reading cannot be double-counted in
 * the aggregate even if the inbox row is lost.
 */
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { emitWithAudit } from "../../shared/route-audit.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { analyse } from "./domain.js";
import * as repo from "./repo.js";
import { invalidateSentiment, RESOURCE } from "./queries.js";

const log = pino({ name: "crm-sentiment-consumer" });

/**
 * How much of the scored text is kept beside the reading. Enough for an officer to
 * see why something scored as it did, not a second copy of the whole interaction.
 */
export const EXCERPT_LIMIT = 280;

/** Identifies the scorer in stored rows so a model change stays traceable. */
export const MODEL = "lexicon-v1";

export interface AnalyseSentimentPayload {
  activityId: string;
  activityType: string;
  contactId: string | null;
  dealId: string | null;
  text: string;
}

function ctxOf(msg: {
  tenantId: string;
  actorId: string;
  correlationId: string;
}): RequestContext {
  return {
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
  } as RequestContext;
}

export function registerSentimentConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.analyseSentiment, async (msg) => {
    const p = msg.payload as AnalyseSentimentPayload;
    if (!p?.activityId) return;

    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        const text = p.text ?? "";
        const result = analyse(text);

        const stored = await repo.insertIgnoringDuplicate(tx, {
          id: randomUUID(),
          tenantId: msg.tenantId,
          activityId: p.activityId,
          activityType: p.activityType || "note",
          contactId: p.contactId ?? null,
          dealId: p.dealId ?? null,
          polarity: result.polarity,
          score: result.score,
          themes: result.themes,
          excerpt: text.slice(0, EXCERPT_LIMIT) || null,
          model: MODEL,
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });

        // The activity already had a reading and this one was discarded. Staying
        // silent is the point: emitting would publish a score that contradicts the
        // stored one and log an audit entry for a write that never happened.
        if (!stored) return;

        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.sentimentScored,
          action: "score",
          resourceType: RESOURCE,
          resourceId: p.activityId,
          // The scored text is deliberately not echoed into the event stream —
          // downstream consumers need the reading, not the customer's words.
          payload: {
            activityId: p.activityId,
            polarity: result.polarity,
            score: result.score,
            themes: result.themes,
            model: MODEL,
          },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "analyseSentiment failed");
      throw err;
    }

    await invalidateSentiment(msg.tenantId);
  });
}
