/**
 * Churn module consumer — reacts to subscription update events.
 *
 * Consumes: billing.subscription.updated
 * When a subscription is updated (plan change, payment, usage), this consumer
 * triggers a churn risk re-evaluation by calling ml-service.
 *
 * If churn probability > 0.70, emits `ml.prediction.churn_risk_high` event
 * for downstream notification/workflow consumers.
 *
 * TX-009: the high-risk event used to be published directly via
 * queue.publish, with markProcessed gating its own early transaction (with
 * the audit row) BEFORE the ml-service call. That left a dual-write hole: a
 * crash (or even just a failed queue.publish call) anywhere after the early
 * markProcessed commit permanently dropped the churn-risk-high event, since a
 * genuine redelivery of the same message would see markProcessed return
 * false and skip re-evaluation entirely -- a silent, unrecoverable drop of a
 * revenue-risk signal. Fixed by moving markProcessed to gate a single
 * transaction, run AFTER the ml-service call, that also performs the
 * resulting outbox enqueues (audit row + the high-risk event, when
 * applicable).
 *
 * The audit row must still be recorded whenever the message is newly
 * processed, REGARDLESS of whether ML evaluation itself throws (that was
 * true before this fix -- the audit used to be enqueued unconditionally,
 * before the ML call even ran) -- so a thrown ML error (network/circuit-
 * breaker) is caught locally: no risk is classified and no churn-high event
 * fires (same as before), but `evaluation` stays null rather than the whole
 * handler jumping to the outer catch and skipping the transaction/audit
 * entirely.
 */

import type { Queue } from "@civitasone/queue";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { pino } from "pino";
import { EVENTS } from "../../topics.js";
import { predictChurn } from "./adapter.js";
import { classifyRiskLevel, fallbackChurnScore, type RiskLevel, type SubscriptionFeatures } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";
const log = pino({ name: "billing-churn-consumer" });
const CHURN_HIGH_EVENT = "ml.prediction.churn_risk_high";

// System-initiated actor for outbox rows with no human actor (this
// consumer's own event, not a re-emission of the inbound message). Mirrors
// the SYSTEM_ACTOR convention used elsewhere in this codebase (e.g.
// workflow-service's nurture-triggers.ts, report-service's scheduled/cron.ts).
// outbox.messages.actor_id is a typed uuid NOT NULL column, so the old
// literal string "system" (which only ever had to satisfy queue.publish's
// untyped envelope) cannot be reused for enqueue().
const SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000000";

interface SubscriptionUpdatedPayload {
  subscriptionId: string;
  tenantId: string;
  planId?: string;
  status?: string;
  updatedFields?: string[];
}

interface ChurnEvaluation {
  probability: number;
  riskLevel: RiskLevel;
  mlResponse: Awaited<ReturnType<typeof predictChurn>>;
}

export function registerChurnConsumers(rawQueue: Queue): void {
  // #146 regression fix: run every handler inside the message tenant context so
  // NOBYPASSRLS + FORCE RLS accepts consumer writes (telephony PR #152 pattern).
  const queue = tenantScoped(rawQueue);
  queue.subscribe<SubscriptionUpdatedPayload>(
    EVENTS.subscriptionUpdated,
    async (msg) => {
      const { subscriptionId, tenantId } = msg.payload;
      const startMs = Date.now();

      const features: SubscriptionFeatures = {
        paymentDelayAvgDays: 0,
        supportTicketCount90d: 0,
        daysSinceLastLogin: 7,
        usageScore: 70,
        tenureDays: 180,
      };

      // Attempt ML prediction for the updated subscription. No side effects
      // of its own (a read/scoring call), so it's safe to redo on every
      // redelivery until the transaction below finally commits. Caught
      // locally (not the outer catch) so a thrown ML error still reaches
      // that transaction below: `evaluation` stays null -- no risk is
      // classified and no churn-high event fires, matching this handler's
      // pre-existing behavior on ML failure -- but the message is still
      // marked processed and the audit row still recorded, exactly as it
      // was before TX-009 moved the audit past this call.
      let evaluation: ChurnEvaluation | null = null;
      try {
        const mlResponse = await predictChurn(
          tenantId,
          subscriptionId,
          features as unknown as Record<string, number>,
        );

        const probability = mlResponse && mlResponse.prediction !== null
          ? mlResponse.prediction
          : fallbackChurnScore(features).probability;

        evaluation = { probability, riskLevel: classifyRiskLevel(probability), mlResponse };
      } catch (err) {
        log.warn(
          { err: (err as Error).message, tenantId, subscriptionId, processingTimeMs: Date.now() - startMs },
          "churn scoring failed for subscription update",
        );
        // Non-fatal — do not throw (message is consumed, not retried for ML
        // failures); evaluation stays null so the transaction below still
        // records the audit row but skips the churn-high event.
      }

      // TX-009: markProcessed + the resulting outbox enqueues (audit row +
      // the high-risk event, when applicable) now commit ATOMICALLY in a
      // single transaction, executed AFTER the ml-service call above --
      // never held open across that external I/O (same principle as
      // TX-007: don't hold a DB transaction across slow network calls).
      // "processed" and "the risk signal will be delivered" are therefore
      // atomic: either both commit together, or neither does and a real
      // redelivery safely retries the whole thing from scratch.
      const isNew = await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return false;
        await enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { service: "billing-service", action: "churn_risk_evaluate", resourceType: "churn", resourceId: subscriptionId, outcome: "success" },
        });
        if (evaluation?.riskLevel === "high") {
          await enqueue(tx, {
            topic: CHURN_HIGH_EVENT,
            eventType: CHURN_HIGH_EVENT,
            tenantId,
            actorId: SYSTEM_ACTOR,
            correlationId: msg.correlationId,
            payload: {
              tenantId,
              domain: "subscriptions",
              entityId: subscriptionId,
              prediction: evaluation.probability,
              confidence: evaluation.mlResponse ? evaluation.mlResponse.confidence : 0,
              factors: evaluation.mlResponse?.factors ?? [],
              timestamp: new Date().toISOString(),
            },
          });
        }
        return true;
      });
      if (!isNew) return;

      if (evaluation?.riskLevel === "high") {
        log.info(
          { tenantId, subscriptionId, probability: evaluation.probability, processingTimeMs: Date.now() - startMs },
          "churn risk high event emitted",
        );
      } else if (evaluation) {
        log.info(
          { tenantId, subscriptionId, probability: evaluation.probability, riskLevel: evaluation.riskLevel, processingTimeMs: Date.now() - startMs },
          "churn risk assessed",
        );
      }
    },
  );
}
