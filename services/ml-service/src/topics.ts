/**
 * Topic + event names owned by ml-service. Convention: {service}.{entity}.{action}
 *
 * ml-service provides centralized ML infrastructure — feature store, model registry,
 * inference engine, and training pipeline — delivering predictive intelligence across
 * CivitasOne's domain services. All predictions are advisory-only.
 */

// ─── EVENTS (published by ml-service) ────────────────────────────────────────

export const EVENTS = {
  /**
   * Lead scored — emitted after lead prediction computed.
   * Payload: { tenantId, domain: "leads", entityId, prediction: number(0–1),
   *   confidence: number(0–1), factors: ExplainabilityFactor[], modelVersion, timestamp, correlationId }
   * Trigger: Successful inference on a lead entity via POST /v1/ml/predict
   */
  leadScored: "ml.prediction.lead_scored",

  /**
   * Breach risk high — ticket breach probability exceeds threshold.
   * Payload: { tenantId, domain: "tickets", entityId, prediction: number(>0.70),
   *   confidence: number(0–1), factors: ExplainabilityFactor[], modelVersion, timestamp, correlationId }
   * Trigger: Ticket breach probability > 0.70 after inference
   */
  breachRiskHigh: "ml.prediction.breach_risk_high",

  /**
   * Anomaly detected — transaction Z-score exceeds threshold.
   * Payload: { tenantId, domain: "transactions", entityId, prediction: number,
   *   confidence: number(0–1), factors: ExplainabilityFactor[], modelVersion, timestamp, correlationId,
   *   anomalyType: "zscore" | "duplicate" | "pattern", severity: "low" | "medium" | "high" }
   * Trigger: Transaction Z-score > 3 or duplicate/pattern anomaly detected
   */
  anomalyDetected: "ml.prediction.anomaly_detected",

  /**
   * Churn risk high — subscription churn probability exceeds threshold.
   * Payload: { tenantId, domain: "subscriptions", entityId, prediction: number(>0.70),
   *   confidence: number(0–1), factors: ExplainabilityFactor[], modelVersion, timestamp, correlationId }
   * Trigger: Subscription churn probability > 0.70 after inference
   */
  churnRiskHigh: "ml.prediction.churn_risk_high",

  /**
   * Stockout risk — demand forecast crosses reorder point.
   * Payload: { tenantId, domain: "inventory", entityId, prediction: number,
   *   confidence: number(0–1), factors: ExplainabilityFactor[], modelVersion, timestamp, correlationId,
   *   reorderPoint: number, forecastedDemand: number }
   * Trigger: Daily demand forecast within lead-time exceeds current stock minus safety stock
   */
  stockoutRisk: "ml.prediction.stockout_risk",

  /**
   * Project task high risk — delay risk score exceeds threshold.
   * Payload: { tenantId, domain: "tasks", entityId, prediction: number(>0.80),
   *   confidence: number(0–1), factors: ExplainabilityFactor[], modelVersion, timestamp, correlationId }
   * Trigger: Task delay risk score > 0.80 after Monte Carlo simulation
   */
  taskHighRisk: "ml.prediction.task_high_risk",

  /**
   * Model drift detected — KL divergence exceeds threshold.
   * Payload: { tenantId, domain: string, modelId: string, klDivergence: number(>0.15),
   *   timestamp, correlationId }
   * Trigger: KL divergence between current prediction distribution and training distribution > 15%
   */
  driftDetected: "ml.model.drift_detected",

  /**
   * Model promoted to active status.
   * Payload: { tenantId, domain: string, modelId: string, version: number,
   *   previousModelId: string | null, metrics: ModelMetrics, promotedBy: string, timestamp, correlationId }
   * Trigger: Model candidate passes quality gates and is promoted via POST /v1/ml/models/:id/promote
   */
  modelPromoted: "ml.model.promoted",

  /**
   * Model auto-deactivated due to quality degradation.
   * Payload: { tenantId, domain: string, modelId: string, version: number,
   *   reason: string, consecutiveFailures: number, timestamp, correlationId }
   * Trigger: 3 consecutive evaluations below domain-specific quality threshold
   */
  modelDeactivated: "ml.model.deactivated",

  /**
   * Bias alert — territory deviation exceeds threshold.
   * Payload: { tenantId, domain: string, modelId: string, dimension: string,
   *   deviationPct: number(>10), affectedTerritory: string, timestamp, correlationId }
   * Trigger: Quarterly bias check finds territory deviation > 10% from population mean
   */
  biasAlert: "ml.bias.territory_deviation",

  /**
   * Training completed for a tenant-domain pair.
   * Payload: { tenantId, domain: string, trainingRunId: string, modelId: string | null,
   *   status: "completed" | "failed" | "skipped", recordCount: number,
   *   metrics: ModelMetrics | null, durationMs: number, timestamp, correlationId }
   * Trigger: Training pipeline finishes processing a tenant-domain pair (success or failure)
   */
  trainingCompleted: "ml.training.completed",
} as const;

// ─── COMMANDS (received by ml-service) ───────────────────────────────────────

export const COMMANDS = {
  /**
   * Request a prediction for a given entity.
   * Payload: { tenantId, domain: FeatureDomain, entityId, features?: Record<string, number | string>,
   *   experimentId?: string, correlationId }
   * Publisher: Domain services (crm, helpdesk, inventory, billing, project, finance)
   */
  predict: "ml.predict.request",

  /**
   * Trigger model training for a specific tenant-domain pair.
   * Payload: { tenantId, domain: ModelDomain, force?: boolean, correlationId }
   * Publisher: Admin action or scheduled cron worker
   */
  train: "ml.train.trigger",

  /**
   * Recompute feature vectors for an entity or batch.
   * Payload: { tenantId, domain: FeatureDomain, entityId?: string, batch?: boolean, correlationId }
   * Publisher: Domain entity change events or manual admin trigger
   */
  recomputeFeatures: "ml.features.recompute",

  /**
   * Create an A/B experiment for model comparison.
   * Payload: { id, tenantId, domain, name, challengerModelId, currentModelId, splitPct }
   * Publisher: POST /v1/ml/experiments route handler
   */
  experimentCreate: "ml.experiment.create",

  /**
   * End an active A/B experiment (completed or cancelled).
   * Payload: { id, tenantId, status: "completed" | "cancelled" }
   * Publisher: PATCH /v1/ml/experiments/:id route handler
   */
  experimentEnd: "ml.experiment.end",
} as const;

// ─── CONSUMED EVENTS (from other services) ───────────────────────────────────

export const CONSUMED = {
  /**
   * CRM lead updated — triggers feature recomputation for lead scoring.
   * Publisher: crm-service
   * Payload: { tenantId, leadId, changes: Record<string, unknown>, updatedBy, timestamp }
   */
  leadUpdated: "crm.lead.updated",

  /**
   * CRM lead created — triggers initial feature computation for lead scoring.
   * Publisher: crm-service
   * Payload: { tenantId, leadId, source, assignedTo, timestamp }
   */
  leadCreated: "crm.lead.created",

  /**
   * Helpdesk ticket created — triggers initial breach risk prediction.
   * Publisher: helpdesk-service
   * Payload: { tenantId, ticketId, category, priority, assigneeId, timestamp }
   */
  ticketCreated: "helpdesk.ticket.created",

  /**
   * Helpdesk ticket updated — triggers breach risk re-scoring.
   * Publisher: helpdesk-service
   * Payload: { tenantId, ticketId, changes: Record<string, unknown>, timestamp }
   */
  ticketUpdated: "helpdesk.ticket.updated",

  /**
   * Inventory receipt posted — triggers demand forecast feature update.
   * Publisher: inventory-service
   * Payload: { tenantId, receiptId, itemId, warehouseId, qty, timestamp }
   */
  movementPosted: "inventory.receipt.posted",

  /**
   * Inventory issue posted — triggers demand forecast feature update.
   * Publisher: inventory-service
   * Payload: { tenantId, issueId, itemId, warehouseId, qty, timestamp }
   */
  issuePosted: "inventory.issue.posted",

  /**
   * Billing subscription updated — triggers churn risk re-scoring.
   * Publisher: billing-service
   * Payload: { tenantId, subscriptionId, changes: Record<string, unknown>, timestamp }
   */
  subscriptionUpdated: "billing.subscription.updated",

  /**
   * Project task updated — triggers delay risk re-computation.
   * Publisher: project-service
   * Payload: { tenantId, projectId, taskId, status, progress, timestamp }
   */
  taskUpdated: "project.task.updated",

  /**
   * Finance transaction posted — triggers anomaly detection scoring.
   * Publisher: finance-service
   * Payload: { tenantId, transactionId, amountPaise: bigint, categoryId, vendorId, timestamp }
   */
  transactionPosted: "finance.transaction.posted",

  /**
   * Tenant deleted — triggers full ML data purge (models, features, predictions).
   * Publisher: tenant-service
   * Payload: { tenantId, deletedAt, correlationId }
   */
  tenantDeleted: "tenant.deleted",
} as const;

export const SERVICE = "ml";

