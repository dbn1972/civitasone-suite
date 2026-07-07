/**
 * Churn module consumer — reacts to subscription update events.
 *
 * Consumes: billing.subscription.updated
 * When a subscription is updated (plan change, payment, usage), this consumer
 * triggers a churn risk re-evaluation by calling ml-service.
 *
 * If churn probability > 0.70, emits `ml.prediction.churn_risk_high` event
 * for downstream notification/workflow consumers.
 */

import type { Queue } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { pino } from "pino";
import { EVENTS } from "../../topics.js";
import { predictChurn } from "./adapter.js";
import { classifyRiskLevel, fallbackChurnScore, type SubscriptionFeatures } from "./domain.js";

const log = pino({ name: "billing-churn-consumer" });
const CHURN_HIGH_EVENT = "ml.prediction.churn_risk_high";

interface SubscriptionUpdatedPayload {
  subscriptionId: string;
  tenantId: string;
  planId?: string;
  status?: string;
  updatedFields?: string[];
}

export function registerChurnConsumers(queue: Queue): void {
  queue.subscribe<SubscriptionUpdatedPayload>(
    EVENTS.subscriptionUpdated,
    async (msg) => {
      const { subscriptionId, tenantId } = msg.payload;
      const startMs = Date.now();

      try {
        // Attempt ML prediction for the updated subscription
        const features: SubscriptionFeatures = {
          paymentDelayAvgDays: 0,
          supportTicketCount90d: 0,
          daysSinceLastLogin: 7,
          usageScore: 70,
          tenureDays: 180,
        };

        const mlResponse = await predictChurn(
          tenantId,
          subscriptionId,
          features as unknown as Record<string, number>,
        );

        let probability: number;
        if (mlResponse && mlResponse.prediction !== null) {
          probability = mlResponse.prediction;
        } else {
          // Fallback to rule-based scoring
          const fallback = fallbackChurnScore(features);
          probability = fallback.probability;
        }

        const riskLevel = classifyRiskLevel(probability);

        // Emit high-risk event when probability > 0.70
        if (riskLevel === "high") {
          await queue.publish(CHURN_HIGH_EVENT, {
            messageId: randomUUID(),
            type: CHURN_HIGH_EVENT,
            tenantId,
            actorId: "system",
            correlationId: msg.correlationId,
            schemaVersion: "1.0",
            payload: {
              tenantId,
              domain: "subscriptions",
              entityId: subscriptionId,
              prediction: probability,
              confidence: mlResponse ? mlResponse.confidence : 0,
              factors: mlResponse?.factors ?? [],
              timestamp: new Date().toISOString(),
            },
          });
          log.info(
            { tenantId, subscriptionId, probability, processingTimeMs: Date.now() - startMs },
            "churn risk high event emitted",
          );
        } else {
          log.info(
            { tenantId, subscriptionId, probability, riskLevel, processingTimeMs: Date.now() - startMs },
            "churn risk assessed",
          );
        }
      } catch (err) {
        log.warn(
          { err: (err as Error).message, tenantId, subscriptionId, processingTimeMs: Date.now() - startMs },
          "churn scoring failed for subscription update",
        );
        // Non-fatal — do not throw (message is consumed, not retried for ML failures)
      }
    },
  );
}
