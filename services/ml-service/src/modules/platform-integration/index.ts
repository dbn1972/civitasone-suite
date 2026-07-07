/**
 * Platform Integration Module — Workflow, Search, Plugin, Audit
 *
 * Wires ML prediction events and model lifecycle events to the broader CivitasOne platform:
 * - Workflow: Emits `workflow.instance.create` command on high-risk predictions
 *   (breach > 0.70, delay > 0.80, anomaly severity "high")
 * - Search: Indexes prediction status values (at-risk, high-confidence, anomaly-flagged)
 *   as filterable facets in search service
 * - Plugin: Publishes prediction events to plugin-service event subscription mechanism
 *   (ml.prediction.* topics)
 * - Audit: Records every model training, promotion, deactivation, and experiment change
 *   via `audit.event.record` with actor/timestamp/reason. Retains prediction logs for
 *   180 days (CERT-In compliance)
 *
 * Validates: Requirements 24.2, 24.3, 24.6, 25.1, 25.5, 25.6
 */

import { pino } from "pino";
import { randomUUID } from "node:crypto";
import { enqueue } from "../../shared/outbox.js";
import { db } from "../../shared/db.js";
import type { ExplainabilityFactor } from "../inference/domain.js";

const log = pino({ name: "ml-platform-integration" });

// ─── Constants ───────────────────────────────────────────────────────────────

/** Topic for workflow task creation commands */
export const WORKFLOW_INSTANCE_CREATE = "workflow.instance.create";

/** Topic for audit event recording */
export const AUDIT_EVENT_RECORD = "audit.event.record";

/** Topic for plugin event subscription */
export const PLUGIN_EVENT_PREFIX = "ml.prediction";

/** Topic for search index updates */
export const SEARCH_INDEX_UPDATE = "search.facet.update";

/** Prediction log retention period in days (CERT-In compliance) */
export const PREDICTION_LOG_RETENTION_DAYS = 180;

/** System actor ID for automated platform operations */
const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

// ─── Threshold Configuration ─────────────────────────────────────────────────

export interface HighRiskThresholds {
  breachProbability: number;
  delayRisk: number;
  anomalySeverities: string[];
}

export const DEFAULT_THRESHOLDS: HighRiskThresholds = {
  breachProbability: 0.70,
  delayRisk: 0.80,
  anomalySeverities: ["high"],
};

// ─── Prediction Event Payload ────────────────────────────────────────────────

export interface PredictionEventPayload {
  tenantId: string;
  domain: string;
  entityId: string;
  prediction: number | null;
  confidence: number;
  factors: ExplainabilityFactor[];
  modelVersion: number | null;
  timestamp: string;
  correlationId: string;
  anomalySeverity?: string;
}

// ─── Prediction Status Classification ────────────────────────────────────────

export type PredictionStatus = "at-risk" | "high-confidence" | "anomaly-flagged" | "normal";

/**
 * Classify a prediction into a status category for search indexing.
 */
export function classifyPredictionStatus(
  domain: string,
  prediction: number | null,
  confidence: number,
  anomalySeverity?: string,
): PredictionStatus {
  // Anomaly domain with high severity
  if (domain === "transactions" && anomalySeverity === "high") {
    return "anomaly-flagged";
  }

  // High-risk predictions
  if (prediction != null) {
    if (domain === "tickets" && prediction > DEFAULT_THRESHOLDS.breachProbability) {
      return "at-risk";
    }
    if (domain === "tasks" && prediction > DEFAULT_THRESHOLDS.delayRisk) {
      return "at-risk";
    }
    if (domain === "subscriptions" && prediction > 0.70) {
      return "at-risk";
    }
  }

  // High confidence (successful, non-risky prediction)
  if (confidence > 0.70 && prediction != null) {
    return "high-confidence";
  }

  return "normal";
}

// ─── 1. Workflow Integration ─────────────────────────────────────────────────

/**
 * Determines whether a prediction event qualifies as high-risk
 * requiring a workflow task creation.
 */
export function isHighRiskPrediction(
  domain: string,
  prediction: number | null,
  anomalySeverity?: string,
  thresholds: HighRiskThresholds = DEFAULT_THRESHOLDS,
): boolean {
  if (prediction == null) return false;

  switch (domain) {
    case "tickets":
      return prediction > thresholds.breachProbability;
    case "tasks":
      return prediction > thresholds.delayRisk;
    case "transactions":
      return thresholds.anomalySeverities.includes(anomalySeverity ?? "");
    default:
      return false;
  }
}

/**
 * Get the workflow definition key for a given prediction domain.
 * Maps high-risk predictions to the appropriate workflow process.
 */
function getWorkflowDefinitionKey(domain: string): string {
  switch (domain) {
    case "tickets":
      return "ml-breach-risk-review";
    case "tasks":
      return "ml-delay-risk-review";
    case "transactions":
      return "ml-anomaly-review";
    default:
      return "ml-prediction-review";
  }
}

/**
 * Get the responsible role for reviewing a high-risk prediction.
 */
function getResponsibleRole(domain: string): string {
  switch (domain) {
    case "tickets":
      return "helpdesk_manager";
    case "tasks":
      return "project_manager";
    case "transactions":
      return "audit_officer";
    default:
      return "tenant_admin";
  }
}

/**
 * Emit a workflow task creation command when a prediction exceeds high-risk thresholds.
 *
 * Requirement 25.1: WHEN a prediction exceeds a high-risk threshold
 * (breach > 0.70, delay > 0.80, anomaly severity high),
 * emit a workflow task creation command for the responsible role.
 */
export async function emitWorkflowTaskOnHighRisk(
  event: PredictionEventPayload,
  thresholds: HighRiskThresholds = DEFAULT_THRESHOLDS,
): Promise<boolean> {
  if (!isHighRiskPrediction(event.domain, event.prediction, event.anomalySeverity, thresholds)) {
    return false;
  }

  const correlationId = event.correlationId || randomUUID();

  try {
    await db.transaction(async (tx) => {
      await enqueue(tx, {
        topic: WORKFLOW_INSTANCE_CREATE,
        eventType: WORKFLOW_INSTANCE_CREATE,
        tenantId: event.tenantId,
        actorId: SYSTEM_ACTOR_ID,
        correlationId,
        payload: {
          tenantId: event.tenantId,
          definitionKey: getWorkflowDefinitionKey(event.domain),
          businessKey: `ml-risk:${event.domain}:${event.entityId}`,
          variables: {
            entityId: event.entityId,
            domain: event.domain,
            prediction: event.prediction,
            confidence: event.confidence,
            factors: event.factors,
            modelVersion: event.modelVersion,
            timestamp: event.timestamp,
            responsibleRole: getResponsibleRole(event.domain),
          },
        },
      });
    });

    log.info({
      tenantId: event.tenantId,
      domain: event.domain,
      entityId: event.entityId,
      prediction: event.prediction,
      correlationId,
    }, "workflow task creation command emitted for high-risk prediction");

    return true;
  } catch (err) {
    log.error({
      tenantId: event.tenantId,
      domain: event.domain,
      entityId: event.entityId,
      err: (err as Error).message,
    }, "failed to emit workflow task creation command");
    return false;
  }
}

// ─── 2. Search Integration ───────────────────────────────────────────────────

export interface SearchFacetPayload {
  tenantId: string;
  entityId: string;
  entityType: string;
  facets: Record<string, string>;
}

/**
 * Index prediction status values as filterable facets in the search service.
 *
 * Requirement 25.5: Index prediction status values (at-risk, high-confidence,
 * anomaly-flagged) in the search service as filterable facets.
 */
export async function indexPredictionStatusInSearch(
  event: PredictionEventPayload,
): Promise<boolean> {
  const status = classifyPredictionStatus(
    event.domain,
    event.prediction,
    event.confidence,
    event.anomalySeverity,
  );

  // Only index non-normal statuses
  if (status === "normal") return false;

  const correlationId = event.correlationId || randomUUID();

  try {
    await db.transaction(async (tx) => {
      await enqueue(tx, {
        topic: SEARCH_INDEX_UPDATE,
        eventType: SEARCH_INDEX_UPDATE,
        tenantId: event.tenantId,
        actorId: SYSTEM_ACTOR_ID,
        correlationId,
        payload: {
          tenantId: event.tenantId,
          entityId: event.entityId,
          entityType: event.domain,
          facets: {
            predictionStatus: status,
            predictionDomain: event.domain,
            predictionConfidence: event.confidence > 0.70 ? "high" : event.confidence > 0.40 ? "medium" : "low",
          },
        } satisfies SearchFacetPayload,
      });
    });

    log.info({
      tenantId: event.tenantId,
      domain: event.domain,
      entityId: event.entityId,
      status,
      correlationId,
    }, "prediction status indexed in search service");

    return true;
  } catch (err) {
    log.error({
      tenantId: event.tenantId,
      domain: event.domain,
      entityId: event.entityId,
      err: (err as Error).message,
    }, "failed to index prediction status in search");
    return false;
  }
}

// ─── 3. Plugin Integration ───────────────────────────────────────────────────

/**
 * Publish prediction events to the plugin-service event subscription mechanism.
 * Plugins can subscribe to `ml.prediction.*` event topics.
 *
 * Requirement 25.6: Publish prediction events to plugin-service event subscription,
 * enabling third-party plugins to subscribe to ml.prediction.* topics.
 */
export async function publishPredictionEventToPlugins(
  event: PredictionEventPayload,
  eventTopic: string,
): Promise<boolean> {
  // Only forward ml.prediction.* events to the plugin subscription mechanism
  if (!eventTopic.startsWith("ml.prediction.")) return false;

  const correlationId = event.correlationId || randomUUID();

  try {
    await db.transaction(async (tx) => {
      await enqueue(tx, {
        topic: `plugin.event.${eventTopic}`,
        eventType: eventTopic,
        tenantId: event.tenantId,
        actorId: SYSTEM_ACTOR_ID,
        correlationId,
        payload: {
          tenantId: event.tenantId,
          domain: event.domain,
          entityId: event.entityId,
          prediction: event.prediction,
          confidence: event.confidence,
          factors: event.factors,
          modelVersion: event.modelVersion,
          timestamp: event.timestamp,
          correlationId,
          originalTopic: eventTopic,
        },
      });
    });

    log.info({
      tenantId: event.tenantId,
      domain: event.domain,
      entityId: event.entityId,
      eventTopic,
      correlationId,
    }, "prediction event published to plugin service");

    return true;
  } catch (err) {
    log.error({
      tenantId: event.tenantId,
      domain: event.domain,
      entityId: event.entityId,
      eventTopic,
      err: (err as Error).message,
    }, "failed to publish prediction event to plugin service");
    return false;
  }
}

// ─── 4. Audit Integration ────────────────────────────────────────────────────

export type ModelLifecycleAction =
  | "model.training.started"
  | "model.training.completed"
  | "model.training.failed"
  | "model.promoted"
  | "model.deactivated"
  | "experiment.created"
  | "experiment.ended"
  | "experiment.cancelled";

export interface AuditEventInput {
  tenantId: string;
  actorId: string;
  action: ModelLifecycleAction;
  resourceType: string;
  resourceId: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Record a model lifecycle event in the audit service via `audit.event.record`.
 *
 * Requirement 24.3: Record every model training run, model promotion,
 * model deactivation, and A/B experiment configuration change in the audit
 * service with actor, timestamp, and reason fields.
 *
 * Requirement 24.6: Retain prediction logs for 180 days in audit service
 * (CERT-In compliance).
 */
export async function recordAuditEvent(input: AuditEventInput): Promise<boolean> {
  const correlationId = randomUUID();

  try {
    await db.transaction(async (tx) => {
      await enqueue(tx, {
        topic: AUDIT_EVENT_RECORD,
        eventType: AUDIT_EVENT_RECORD,
        tenantId: input.tenantId,
        actorId: input.actorId,
        correlationId,
        payload: {
          service: "ml",
          action: input.action,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          reason: input.reason ?? null,
          metadata: input.metadata ?? {},
          timestamp: new Date().toISOString(),
          retentionDays: PREDICTION_LOG_RETENTION_DAYS,
          outcome: "success",
        },
      });
    });

    log.info({
      tenantId: input.tenantId,
      actorId: input.actorId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      correlationId,
    }, "audit event recorded for model lifecycle operation");

    return true;
  } catch (err) {
    log.error({
      tenantId: input.tenantId,
      action: input.action,
      resourceId: input.resourceId,
      err: (err as Error).message,
    }, "failed to record audit event");
    return false;
  }
}

// ─── Convenience Functions for Model Operations ──────────────────────────────

/**
 * Record audit for model training start.
 */
export async function auditTrainingStarted(
  tenantId: string,
  actorId: string,
  trainingRunId: string,
  domain: string,
): Promise<boolean> {
  return recordAuditEvent({
    tenantId,
    actorId,
    action: "model.training.started",
    resourceType: "ml-training-run",
    resourceId: trainingRunId,
    reason: `Training initiated for domain: ${domain}`,
    metadata: { domain },
  });
}

/**
 * Record audit for model training completion.
 */
export async function auditTrainingCompleted(
  tenantId: string,
  actorId: string,
  trainingRunId: string,
  domain: string,
  metrics: Record<string, unknown>,
): Promise<boolean> {
  return recordAuditEvent({
    tenantId,
    actorId,
    action: "model.training.completed",
    resourceType: "ml-training-run",
    resourceId: trainingRunId,
    reason: `Training completed for domain: ${domain}`,
    metadata: { domain, metrics },
  });
}

/**
 * Record audit for model training failure.
 */
export async function auditTrainingFailed(
  tenantId: string,
  actorId: string,
  trainingRunId: string,
  domain: string,
  errorMessage: string,
): Promise<boolean> {
  return recordAuditEvent({
    tenantId,
    actorId,
    action: "model.training.failed",
    resourceType: "ml-training-run",
    resourceId: trainingRunId,
    reason: `Training failed for domain: ${domain} — ${errorMessage}`,
    metadata: { domain, errorMessage },
  });
}

/**
 * Record audit for model promotion.
 */
export async function auditModelPromoted(
  tenantId: string,
  actorId: string,
  modelId: string,
  domain: string,
  version: number,
  reason?: string,
): Promise<boolean> {
  return recordAuditEvent({
    tenantId,
    actorId,
    action: "model.promoted",
    resourceType: "ml-model",
    resourceId: modelId,
    reason: reason ?? `Model version ${version} promoted for domain: ${domain}`,
    metadata: { domain, version },
  });
}

/**
 * Record audit for model deactivation.
 */
export async function auditModelDeactivated(
  tenantId: string,
  actorId: string,
  modelId: string,
  domain: string,
  reason: string,
): Promise<boolean> {
  return recordAuditEvent({
    tenantId,
    actorId,
    action: "model.deactivated",
    resourceType: "ml-model",
    resourceId: modelId,
    reason,
    metadata: { domain },
  });
}

/**
 * Record audit for experiment creation.
 */
export async function auditExperimentCreated(
  tenantId: string,
  actorId: string,
  experimentId: string,
  domain: string,
  name: string,
): Promise<boolean> {
  return recordAuditEvent({
    tenantId,
    actorId,
    action: "experiment.created",
    resourceType: "ml-experiment",
    resourceId: experimentId,
    reason: `Experiment "${name}" created for domain: ${domain}`,
    metadata: { domain, name },
  });
}

/**
 * Record audit for experiment end.
 */
export async function auditExperimentEnded(
  tenantId: string,
  actorId: string,
  experimentId: string,
  domain: string,
  outcome: "completed" | "cancelled",
): Promise<boolean> {
  return recordAuditEvent({
    tenantId,
    actorId,
    action: outcome === "completed" ? "experiment.ended" : "experiment.cancelled",
    resourceType: "ml-experiment",
    resourceId: experimentId,
    reason: `Experiment ${outcome} for domain: ${domain}`,
    metadata: { domain, outcome },
  });
}

// ─── Orchestrator — Process All Platform Integrations ────────────────────────

/**
 * Process a prediction event through all platform integrations.
 * Called by the prediction event outbox relay after a prediction is stored.
 *
 * Executes: workflow task creation, search indexing, plugin notification.
 * Audit events for model lifecycle are handled separately via convenience functions.
 */
export async function processPredictionEvent(
  event: PredictionEventPayload,
  eventTopic: string,
): Promise<{
  workflowEmitted: boolean;
  searchIndexed: boolean;
  pluginPublished: boolean;
}> {
  const [workflowEmitted, searchIndexed, pluginPublished] = await Promise.all([
    emitWorkflowTaskOnHighRisk(event),
    indexPredictionStatusInSearch(event),
    publishPredictionEventToPlugins(event, eventTopic),
  ]);

  return { workflowEmitted, searchIndexed, pluginPublished };
}
