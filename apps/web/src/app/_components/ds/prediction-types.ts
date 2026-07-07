/**
 * Shared prediction data types used by entity views across CRM, helpdesk,
 * inventory, billing, and project modules.
 */

import type { ExplainabilityFactor } from "./ExplainabilityTooltip";

/** Prediction data attached to entity rows/cards from ML-service predictions */
export interface EntityPrediction {
  /** Prediction probability value (0.0–1.0) */
  probability: number;
  /** Confidence score (0.0–1.0) — drives badge color */
  confidence: number;
  /** Top contributing factors (max 3) */
  factors?: ExplainabilityFactor[];
  /** Whether a fallback model was used */
  isFallback?: boolean;
  /** Staleness label (e.g., "3h ago") */
  staleness?: string;
}

/**
 * Risk threshold definitions for notification emission.
 * Notifications are emitted when predictions exceed these thresholds:
 * - breach > 0.70 (SLA breach risk)
 * - delay > 0.80 (project task delay)
 * - churn > 0.70 (subscription churn)
 * - anomaly severity = "high"
 */
export const RISK_THRESHOLDS = {
  breach: 0.70,
  delay: 0.80,
  churn: 0.70,
  anomaly: "high",
} as const;

/** ML prediction notification event types used for notification-service SSE */
export type MLNotificationType =
  | "ml.prediction.breach_risk_high"
  | "ml.prediction.task_high_risk"
  | "ml.prediction.churn_risk_high"
  | "ml.prediction.anomaly_detected";

/** Shape of the ML risk notification payload delivered via SSE */
export interface MLRiskNotification {
  id: string;
  type: MLNotificationType;
  title: string;
  body: string;
  metadata: {
    domain: string;
    entityId: string;
    prediction: number;
    confidence: number;
    reviewUrl: string;
  };
  createdAt: string;
}
