/**
 * ML Prediction High-Risk Notification Consumer.
 *
 * Subscribes to ML prediction events that exceed risk thresholds and publishes
 * real-time notifications via the notification-service SSE stream.
 *
 * Risk thresholds:
 * - breach > 0.70 (SLA breach risk)
 * - delay > 0.80 (project task delay)
 * - churn > 0.70 (subscription churn)
 * - anomaly severity = "high"
 *
 * Each notification includes a "Review" action link pointing to entity detail.
 * Delivery target: within 2 seconds via existing SSE infrastructure.
 *
 * Validates: Requirements 22.5, 25.2
 */

import { pino } from "pino";
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { notifications, type NotificationRow } from "../stream/schema.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

const log = pino({ name: "ml-predictions-consumer" });

/**
 * System actor for scheduler/consumer-originated writes.
 *
 * stream.notifications.created_by is `uuid NOT NULL`, so the literal "system"
 * this consumer used to pass was rejected by Postgres with "invalid input syntax
 * for type uuid". The insert threw, the catch below logged it, and — because the
 * idempotency marker had already been committed in its own transaction — the
 * message was consumed for good. Every ML high-risk notification was therefore
 * lost silently. Same constant/convention as email/sweeper.ts.
 */
const SYSTEM_ACTOR = "00000000-0000-4000-8000-000000000000";

// ─── Event Topics ────────────────────────────────────────────────────────────

export const ML_PREDICTION_EVENTS = {
  breachRiskHigh: "ml.prediction.breach_risk_high",
  taskHighRisk: "ml.prediction.task_high_risk",
  churnRiskHigh: "ml.prediction.churn_risk_high",
  anomalyDetected: "ml.prediction.anomaly_detected",
} as const;

// ─── Risk Thresholds ─────────────────────────────────────────────────────────

const RISK_THRESHOLDS = {
  breach: 0.70,
  delay: 0.80,
  churn: 0.70,
} as const;

// ─── Payload Types ───────────────────────────────────────────────────────────

interface MLPredictionEventPayload {
  tenantId: string;
  domain: string;
  entityId: string;
  prediction: number;
  confidence: number;
  factors: Array<{ feature: string; contribution: number; direction: "positive" | "negative" }>;
  modelVersion: number;
  timestamp: string;
  correlationId: string;
  /** Only present for anomaly events */
  severity?: "low" | "medium" | "high";
}

// ─── Review URL Builders ─────────────────────────────────────────────────────

function buildReviewUrl(domain: string, entityId: string): string {
  switch (domain) {
    case "tickets":
      return `/helpdesk/tickets/${entityId}`;
    case "tasks":
      return `/projects/${entityId}`;
    case "subscriptions":
      return `/billing/subscriptions/${entityId}`;
    case "transactions":
      return `/finance/anomalies?entityId=${entityId}`;
    case "leads":
      return `/crm/deals/${entityId}`;
    case "inventory":
      return `/inventory/items/${entityId}`;
    default:
      return `/`;
  }
}

// ─── Notification Title/Body Builders ────────────────────────────────────────

function buildNotificationContent(
  eventType: string,
  payload: MLPredictionEventPayload,
): { title: string; body: string } {
  const pct = Math.round(payload.prediction * 100);

  switch (eventType) {
    case ML_PREDICTION_EVENTS.breachRiskHigh:
      return {
        title: "SLA Breach Risk Detected",
        body: `Ticket has ${pct}% predicted probability of SLA breach. Review and consider reassignment.`,
      };
    case ML_PREDICTION_EVENTS.taskHighRisk:
      return {
        title: "High Task Delay Risk",
        body: `Task delay risk score is ${pct}%. Consider resource reallocation or timeline adjustment.`,
      };
    case ML_PREDICTION_EVENTS.churnRiskHigh:
      return {
        title: "Subscription Churn Risk",
        body: `Subscription has ${pct}% churn probability. Review engagement and retention actions.`,
      };
    case ML_PREDICTION_EVENTS.anomalyDetected:
      return {
        title: "Financial Anomaly Detected",
        body: `Transaction flagged as ${payload.severity ?? "high"} severity anomaly. Review for potential issues.`,
      };
    default:
      return {
        title: "ML Risk Alert",
        body: `Prediction risk score: ${pct}%. Review the entity for corrective action.`,
      };
  }
}

// ─── Consumer Handler ────────────────────────────────────────────────────────

/**
 * Determines whether a prediction event exceeds the risk threshold
 * and should generate a notification.
 */
function exceedsRiskThreshold(eventType: string, payload: MLPredictionEventPayload): boolean {
  switch (eventType) {
    case ML_PREDICTION_EVENTS.breachRiskHigh:
      return payload.prediction > RISK_THRESHOLDS.breach;
    case ML_PREDICTION_EVENTS.taskHighRisk:
      return payload.prediction > RISK_THRESHOLDS.delay;
    case ML_PREDICTION_EVENTS.churnRiskHigh:
      return payload.prediction > RISK_THRESHOLDS.churn;
    case ML_PREDICTION_EVENTS.anomalyDetected:
      return payload.severity === "high";
    default:
      return false;
  }
}

/**
 * Register the ML prediction event consumers on the provided queue.
 * When a high-risk prediction event arrives:
 * 1. Verify it exceeds the risk threshold
 * 2. Persist a notification for the target user(s)
 * 3. Publish via Redis pub/sub for real-time SSE delivery (within 2s)
 */
export function registerMLPredictionConsumers(queue: Queue): void {
  // RLS (#146): every handler must run inside the message's tenant context.
  queue = tenantScoped(queue);
  const allTopics = Object.values(ML_PREDICTION_EVENTS);

  for (const topic of allTopics) {
    queue.subscribe(topic, async (msg: CommandEnvelope) => {
      const payload = msg.payload as unknown as MLPredictionEventPayload;
      const { tenantId, entityId, domain, correlationId } = payload;

      const { title, body } = buildNotificationContent(topic, payload);
      const reviewUrl = buildReviewUrl(domain, entityId);

      // For now, publish notification to the actor who owns the entity.
      // In production, this would resolve to the assigned agent/manager via a lookup.
      // The notification is tenant-scoped; the SSE channel routes to the correct user.
      const targetUserId = msg.actorId ?? tenantId;

      try {
        // ONE handler = ONE transaction, with markProcessed as its first
        // operation. Previously the marker was committed separately BEFORE the
        // write, so any insert failure consumed the message permanently and the
        // notification could never be recovered by a retry.
        const notification: NotificationRow | null = await db.transaction(async (tx) => {
          if (!(await markProcessed(tx, msg.messageId))) {
            log.info({ messageId: msg.messageId, topic }, "duplicate ML prediction event — skipping");
            return null;
          }
          if (!exceedsRiskThreshold(topic, payload)) {
            log.debug(
              { topic, tenantId, entityId, prediction: payload.prediction },
              "prediction below threshold — no notification",
            );
            return null;
          }
          const rows = await tx.insert(notifications).values({
            tenantId,
            userId: targetUserId,
            type: topic,
            title,
            body,
            metadata: {
              domain,
              entityId,
              prediction: payload.prediction,
              confidence: payload.confidence,
              reviewUrl,
              factors: payload.factors,
            },
            createdBy: SYSTEM_ACTOR,
          }).returning();
          return rows[0] ?? null;
        });

        // Duplicate, or below threshold: nothing to broadcast.
        if (!notification) return;

        // Publish via Redis pub/sub for real-time SSE delivery (within 2 seconds)
        const { createNotificationPublisher } = await import("../../adapters/pubsub.js");
        const publisher = createNotificationPublisher();
        const channel = `notifications:${tenantId}:${targetUserId}`;
        const ssePayload = {
          id: notification.id,
          type: topic,
          title,
          body,
          metadata: {
            domain,
            entityId,
            prediction: payload.prediction,
            confidence: payload.confidence,
            reviewUrl,
          },
          createdAt: notification.createdAt instanceof Date
            ? notification.createdAt.toISOString()
            : String(notification.createdAt),
        };

        await publisher.publish(channel, ssePayload);

        log.info({
          correlationId,
          tenantId,
          domain,
          entityId,
          topic,
          notificationId: notification.id,
          latencyMs: Date.now() - new Date(payload.timestamp).getTime(),
        }, "ML risk notification published via SSE");
      } catch (err) {
        log.error({
          correlationId,
          tenantId,
          domain,
          entityId,
          topic,
          err: (err as Error).message,
        }, "failed to publish ML risk notification");
      }
    });
  }

  log.info({ topics: allTopics }, "ML prediction notification consumers registered");
}
