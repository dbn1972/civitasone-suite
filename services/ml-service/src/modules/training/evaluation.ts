/**
 * Model Evaluation, Promotion, and Quality Thresholds
 *
 * Computes domain-specific evaluation metrics after training, compares
 * candidate vs current model with quality gates, implements auto-deactivation
 * after 3 consecutive failures below threshold.
 *
 * Validates: Requirements 2.3, 4.4, 21.1, 21.2, 21.3, 21.4, 21.5, 21.6
 */
import { pino } from "pino";
import { randomUUID } from "node:crypto";
import type { ModelDomain } from "../models/schema.js";
import type { ModelMetrics } from "../model-registry/domain.js";
import {
  promote as registryPromote,
  deactivate as registryDeactivate,
  getCurrentModel,
} from "../model-registry/domain.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";

const log = pino({ name: "ml-training-evaluation" });

// ─── Domain-Specific Quality Thresholds ──────────────────────────────────────

/**
 * Quality threshold per domain. Each domain requires different
 * metrics to pass before promotion is allowed.
 */
export interface DomainThreshold {
  domain: ModelDomain;
  /** Primary metric name to evaluate */
  primaryMetric: keyof ModelMetrics;
  /** Threshold value — must be >= this for promotion (or <= for MAPE/FPR) */
  threshold: number;
  /** Direction: "gte" means metric must be >= threshold, "lte" means <= threshold */
  direction: "gte" | "lte";
  /** Optional secondary metric check */
  secondary?: {
    metric: keyof ModelMetrics;
    threshold: number;
    direction: "gte" | "lte";
  };
}

/**
 * Domain-specific quality thresholds as specified in requirements 21.1–21.5:
 * - leads: AUC-ROC ≥ 0.70
 * - subscriptions (churn): AUC-ROC ≥ 0.65
 * - tickets (breach): precision ≥ 0.65 AND recall ≥ 0.80
 * - inventory (demand 30d): MAPE ≤ 0.25
 * - transactions (anomaly): FPR ≤ 0.05
 * - tasks: no explicit threshold in requirements, use accuracy ≥ 0.60
 */
export const DOMAIN_THRESHOLDS: Record<ModelDomain, DomainThreshold> = {
  leads: {
    domain: "leads",
    primaryMetric: "aucRoc",
    threshold: 0.70,
    direction: "gte",
  },
  subscriptions: {
    domain: "subscriptions",
    primaryMetric: "aucRoc",
    threshold: 0.65,
    direction: "gte",
  },
  tickets: {
    domain: "tickets",
    primaryMetric: "precision",
    threshold: 0.65,
    direction: "gte",
    secondary: {
      metric: "recall",
      threshold: 0.80,
      direction: "gte",
    },
  },
  inventory: {
    domain: "inventory",
    primaryMetric: "mape",
    threshold: 0.25,
    direction: "lte",
  },
  transactions: {
    domain: "transactions",
    primaryMetric: "falsePositiveRate",
    threshold: 0.05,
    direction: "lte",
  },
  tasks: {
    domain: "tasks",
    primaryMetric: "accuracy",
    threshold: 0.60,
    direction: "gte",
  },
};

// ─── Extended thresholds for inventory 90-day MAPE ───────────────────────────

/**
 * The 90-day MAPE threshold for demand forecasting (requirement 21.3).
 * Checked in addition to the primary 30-day threshold when mape90d is available.
 */
export const INVENTORY_MAPE_90D_THRESHOLD = 0.35;

// ─── Promotion Tolerance ─────────────────────────────────────────────────────

/**
 * 2% tolerance for metric comparison against current model.
 * A candidate is promoted if it improves OR is within this tolerance.
 */
export const PROMOTION_TOLERANCE = 0.02;

// ─── Auto-deactivation state tracking ────────────────────────────────────────

/**
 * In-memory state tracking consecutive below-threshold evaluations.
 * Key: "{tenantId}:{domain}", Value: count of consecutive failures.
 *
 * This is reset on successful evaluation or service restart.
 * In a production system, this could be persisted to Redis or DB.
 */
const consecutiveFailures = new Map<string, number>();

/** Number of consecutive failures before auto-deactivation */
export const AUTO_DEACTIVATION_THRESHOLD = 3;

function failureKey(tenantId: string, domain: ModelDomain): string {
  return `${tenantId}:${domain}`;
}

/**
 * Get the current consecutive failure count for a tenant-domain pair.
 */
export function getConsecutiveFailureCount(tenantId: string, domain: ModelDomain): number {
  return consecutiveFailures.get(failureKey(tenantId, domain)) ?? 0;
}

/**
 * Reset the consecutive failure count (called on successful evaluation).
 */
export function resetConsecutiveFailures(tenantId: string, domain: ModelDomain): void {
  consecutiveFailures.delete(failureKey(tenantId, domain));
}

/**
 * Increment the consecutive failure count.
 * @returns new failure count
 */
export function incrementConsecutiveFailures(tenantId: string, domain: ModelDomain): number {
  const key = failureKey(tenantId, domain);
  const current = consecutiveFailures.get(key) ?? 0;
  const next = current + 1;
  consecutiveFailures.set(key, next);
  return next;
}

// ─── Evaluation Logic ────────────────────────────────────────────────────────

/**
 * Check whether a model's metrics meet the domain-specific quality threshold.
 *
 * @param domain - The model domain
 * @param metrics - The model's evaluation metrics
 * @returns true if metrics meet threshold requirements, false otherwise
 */
export function meetsDomainThreshold(domain: ModelDomain, metrics: ModelMetrics): boolean {
  const threshold = DOMAIN_THRESHOLDS[domain];
  if (!threshold) return true; // unknown domain — allow

  const primaryValue = metrics[threshold.primaryMetric];
  if (primaryValue == null) {
    // Cannot evaluate without the required metric — fail threshold
    return false;
  }

  // Check primary metric
  const primaryPasses = threshold.direction === "gte"
    ? primaryValue >= threshold.threshold
    : primaryValue <= threshold.threshold;

  if (!primaryPasses) return false;

  // Check secondary metric if defined
  if (threshold.secondary) {
    const secondaryValue = metrics[threshold.secondary.metric];
    if (secondaryValue == null) return false;

    const secondaryPasses = threshold.secondary.direction === "gte"
      ? secondaryValue >= threshold.secondary.threshold
      : secondaryValue <= threshold.secondary.threshold;

    if (!secondaryPasses) return false;
  }

  return true;
}

/**
 * Extended threshold check for inventory domain that also considers 90-day MAPE.
 * Requirement 21.3: MAPE ≤ 0.25 for 30d AND ≤ 0.35 for 90d.
 *
 * @param metrics - Must include `mape` (30d) and optionally a `mape90d` field
 * @param mape90d - The 90-day MAPE value (provided separately since ModelMetrics doesn't have it)
 * @returns true if both 30d and 90d thresholds are met
 */
export function meetsDemandForecastThreshold(metrics: ModelMetrics, mape90d?: number): boolean {
  // Check 30-day threshold via standard check
  if (!meetsDomainThreshold("inventory", metrics)) return false;

  // Check 90-day threshold if provided
  if (mape90d != null && mape90d > INVENTORY_MAPE_90D_THRESHOLD) return false;

  return true;
}

/**
 * Compare candidate metrics against current model metrics.
 * Promotes if candidate improves or is within 2% tolerance of the current model's
 * primary metric. Also ensures candidate meets the domain absolute threshold.
 *
 * @returns "promote" | "reject_below_threshold" | "reject_regression"
 */
export function evaluateCandidate(
  domain: ModelDomain,
  candidateMetrics: ModelMetrics,
  currentMetrics: ModelMetrics | null,
): "promote" | "reject_below_threshold" | "reject_regression" {
  // First check: candidate must meet absolute domain threshold
  if (!meetsDomainThreshold(domain, candidateMetrics)) {
    return "reject_below_threshold";
  }

  // If no current model exists, promote (candidate already meets threshold)
  if (currentMetrics == null) {
    return "promote";
  }

  // Second check: candidate must be within 2% tolerance of current
  const threshold = DOMAIN_THRESHOLDS[domain];
  if (!threshold) return "promote";

  const candidateValue = candidateMetrics[threshold.primaryMetric];
  const currentValue = currentMetrics[threshold.primaryMetric];

  // If either is missing, allow promotion (can't compare)
  if (candidateValue == null || currentValue == null) return "promote";

  if (threshold.direction === "gte") {
    // Higher is better: candidate >= current - tolerance
    if (candidateValue >= currentValue - PROMOTION_TOLERANCE) {
      return "promote";
    }
    return "reject_regression";
  } else {
    // Lower is better (MAPE, FPR): candidate <= current + tolerance
    if (candidateValue <= currentValue + PROMOTION_TOLERANCE) {
      return "promote";
    }
    return "reject_regression";
  }
}

// ─── Evaluation and Promotion Orchestration ──────────────────────────────────

export interface EvaluationResult {
  outcome: "promoted" | "rejected" | "deactivated";
  reason: string;
  metrics: ModelMetrics;
  domain: ModelDomain;
  tenantId: string;
  modelId: string;
  consecutiveFailures: number;
}

/**
 * Evaluate a trained candidate model, decide on promotion, and handle
 * auto-deactivation when quality degrades.
 *
 * Flow:
 * 1. Check candidate metrics against domain threshold
 * 2. Compare vs current model (promote if improvement or within 2% tolerance)
 * 3. If below threshold → increment consecutive failure count
 * 4. If 3 consecutive failures → auto-deactivate → revert to fallback → emit event
 * 5. If promotion succeeds → reset failure count → emit ml.model.promoted event
 *
 * @param modelId - The candidate model ID in the registry
 * @param tenantId - Tenant ID
 * @param domain - Model domain
 * @param candidateMetrics - Computed evaluation metrics for the candidate
 * @param actorId - The actor performing the evaluation (usually system)
 */
export async function evaluateAndPromote(
  modelId: string,
  tenantId: string,
  domain: ModelDomain,
  candidateMetrics: ModelMetrics,
  actorId: string = "00000000-0000-0000-0000-000000000000",
): Promise<EvaluationResult> {
  const correlationId = randomUUID();

  // Get current active model for comparison
  const currentModel = await getCurrentModel(tenantId, domain);
  const currentMetrics = currentModel?.metrics ?? null;

  // Evaluate candidate against thresholds and current model
  const decision = evaluateCandidate(domain, candidateMetrics, currentMetrics);

  if (decision === "promote") {
    // Attempt promotion via model registry
    const promoted = await registryPromote(modelId, actorId);

    if (promoted) {
      // Reset consecutive failures on success
      resetConsecutiveFailures(tenantId, domain);

      log.info(
        { tenantId, domain, modelId, metrics: candidateMetrics },
        "model promoted successfully"
      );

      return {
        outcome: "promoted",
        reason: "metrics_meet_threshold",
        metrics: candidateMetrics,
        domain,
        tenantId,
        modelId,
        consecutiveFailures: 0,
      };
    }

    // Registry rejected promotion (metrics gate in registry itself)
    // This shouldn't happen since we already checked, but handle gracefully
    const failures = incrementConsecutiveFailures(tenantId, domain);
    log.warn(
      { tenantId, domain, modelId, failures },
      "promotion rejected by registry despite passing evaluation"
    );

    return {
      outcome: "rejected",
      reason: "registry_rejection",
      metrics: candidateMetrics,
      domain,
      tenantId,
      modelId,
      consecutiveFailures: failures,
    };
  }

  // Candidate rejected — increment consecutive failures
  const failures = incrementConsecutiveFailures(tenantId, domain);

  log.warn(
    { tenantId, domain, modelId, decision, failures, candidateMetrics },
    "candidate model rejected"
  );

  // Check auto-deactivation threshold
  if (failures >= AUTO_DEACTIVATION_THRESHOLD && currentModel) {
    // Auto-deactivate the current model
    await handleAutoDeactivation(currentModel.id, tenantId, domain, failures, correlationId);

    return {
      outcome: "deactivated",
      reason: `model_quality_degraded_${failures}_consecutive_failures`,
      metrics: candidateMetrics,
      domain,
      tenantId,
      modelId,
      consecutiveFailures: failures,
    };
  }

  return {
    outcome: "rejected",
    reason: decision === "reject_below_threshold"
      ? "below_domain_threshold"
      : "regression_beyond_tolerance",
    metrics: candidateMetrics,
    domain,
    tenantId,
    modelId,
    consecutiveFailures: failures,
  };
}

/**
 * Handle auto-deactivation: deactivate model, revert to fallback, emit event, log ERROR.
 */
async function handleAutoDeactivation(
  activeModelId: string,
  tenantId: string,
  domain: ModelDomain,
  consecutiveFailureCount: number,
  correlationId: string,
): Promise<void> {
  const reason = `model_quality_degraded: ${consecutiveFailureCount} consecutive evaluations below threshold`;

  log.error(
    { tenantId, domain, modelId: activeModelId, consecutiveFailureCount },
    "auto-deactivating model due to quality degradation — reverting to fallback"
  );

  // Deactivate via model registry (handles fallback reversion internally)
  await registryDeactivate(activeModelId, reason);

  // Emit ml.model.deactivated event
  await db.transaction(async (tx) => {
    await enqueue(tx as Parameters<typeof enqueue>[0], {
      topic: EVENTS.modelDeactivated,
      eventType: EVENTS.modelDeactivated,
      tenantId,
      actorId: "00000000-0000-0000-0000-000000000000",
      correlationId,
      payload: {
        tenantId,
        domain,
        modelId: activeModelId,
        reason,
        consecutiveFailures: consecutiveFailureCount,
        timestamp: new Date().toISOString(),
        correlationId,
      },
    });
  });

  // Reset the failure counter after deactivation
  resetConsecutiveFailures(tenantId, domain);
}

/**
 * Evaluate an active model's current performance (for periodic quality checks).
 * This is called during scheduled evaluations to detect degradation over time.
 *
 * If the model's latest metrics fall below its domain threshold, this increments
 * the consecutive failure counter. After 3 consecutive failures, auto-deactivation occurs.
 *
 * @param tenantId - Tenant ID
 * @param domain - Model domain
 * @param latestMetrics - Latest evaluation metrics for the active model
 * @returns The evaluation result
 */
export async function evaluateActiveModel(
  tenantId: string,
  domain: ModelDomain,
  latestMetrics: ModelMetrics,
): Promise<EvaluationResult> {
  const currentModel = await getCurrentModel(tenantId, domain);

  if (!currentModel) {
    return {
      outcome: "rejected",
      reason: "no_active_model",
      metrics: latestMetrics,
      domain,
      tenantId,
      modelId: "",
      consecutiveFailures: 0,
    };
  }

  const passesThreshold = meetsDomainThreshold(domain, latestMetrics);
  const correlationId = randomUUID();

  if (passesThreshold) {
    // Model is performing well — reset failure counter
    resetConsecutiveFailures(tenantId, domain);
    return {
      outcome: "promoted", // "still active" — model retains its position
      reason: "metrics_within_threshold",
      metrics: latestMetrics,
      domain,
      tenantId,
      modelId: currentModel.id,
      consecutiveFailures: 0,
    };
  }

  // Below threshold — increment consecutive failure count
  const failures = incrementConsecutiveFailures(tenantId, domain);

  log.warn(
    { tenantId, domain, modelId: currentModel.id, failures, latestMetrics },
    "active model evaluation below threshold"
  );

  // Check auto-deactivation
  if (failures >= AUTO_DEACTIVATION_THRESHOLD) {
    await handleAutoDeactivation(currentModel.id, tenantId, domain, failures, correlationId);

    return {
      outcome: "deactivated",
      reason: `model_quality_degraded_${failures}_consecutive_failures`,
      metrics: latestMetrics,
      domain,
      tenantId,
      modelId: currentModel.id,
      consecutiveFailures: failures,
    };
  }

  return {
    outcome: "rejected",
    reason: `below_threshold_${failures}_of_${AUTO_DEACTIVATION_THRESHOLD}`,
    metrics: latestMetrics,
    domain,
    tenantId,
    modelId: currentModel.id,
    consecutiveFailures: failures,
  };
}

// ─── Exports for Testing ─────────────────────────────────────────────────────

export { consecutiveFailures as _consecutiveFailures };
