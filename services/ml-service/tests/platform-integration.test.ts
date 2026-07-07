/**
 * Platform Integration Tests — Workflow, Search, Plugin, Audit
 *
 * Tests:
 * - Workflow task creation on high-risk predictions (breach > 0.70, delay > 0.80, anomaly high)
 * - Search facet indexing for at-risk/high-confidence/anomaly-flagged predictions
 * - Plugin event publishing for ml.prediction.* topics
 * - Audit event recording for model lifecycle operations
 * - Prediction log retention (180 days CERT-In compliance)
 *
 * Validates: Requirements 24.2, 24.3, 24.6, 25.1, 25.5, 25.6
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isHighRiskPrediction,
  classifyPredictionStatus,
  emitWorkflowTaskOnHighRisk,
  indexPredictionStatusInSearch,
  publishPredictionEventToPlugins,
  recordAuditEvent,
  auditModelPromoted,
  auditModelDeactivated,
  auditTrainingStarted,
  auditTrainingCompleted,
  auditTrainingFailed,
  auditExperimentCreated,
  auditExperimentEnded,
  processPredictionEvent,
  WORKFLOW_INSTANCE_CREATE,
  AUDIT_EVENT_RECORD,
  SEARCH_INDEX_UPDATE,
  PREDICTION_LOG_RETENTION_DAYS,
  DEFAULT_THRESHOLDS,
  type PredictionEventPayload,
} from "../src/modules/platform-integration/index.js";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const enqueuedMessages: Array<{ topic: string; payload: Record<string, unknown>; tenantId: string; actorId: string; correlationId: string }> = [];

vi.mock("../../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async (_tx: unknown, msg: Record<string, unknown>) => {
    enqueuedMessages.push(msg as typeof enqueuedMessages[number]);
  }),
  markProcessed: vi.fn(async () => true),
}));

vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async (_tx: unknown, msg: Record<string, unknown>) => {
    enqueuedMessages.push(msg as typeof enqueuedMessages[number]);
  }),
  markProcessed: vi.fn(async () => true),
}));

vi.mock("../src/shared/db.js", () => ({
  db: {
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
      await fn({});
    }),
  },
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: { getOrLoad: vi.fn(), invalidate: vi.fn(), put: vi.fn() },
  queue: { publish: vi.fn() },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildPredictionEvent(overrides?: Partial<PredictionEventPayload>): PredictionEventPayload {
  return {
    tenantId: "tenant-001",
    domain: "tickets",
    entityId: "entity-001",
    prediction: 0.85,
    confidence: 0.78,
    factors: [{ feature: "elapsedPctOfSla", contribution: 0.45, direction: "positive" as const }],
    modelVersion: 3,
    timestamp: new Date().toISOString(),
    correlationId: "corr-001",
    ...overrides,
  };
}

beforeEach(() => {
  enqueuedMessages.length = 0;
});

// ─── 1. isHighRiskPrediction — threshold classification ──────────────────────

describe("isHighRiskPrediction", () => {
  it("returns true for breach probability > 0.70 (tickets domain)", () => {
    expect(isHighRiskPrediction("tickets", 0.75)).toBe(true);
    expect(isHighRiskPrediction("tickets", 0.71)).toBe(true);
  });

  it("returns false for breach probability <= 0.70 (tickets domain)", () => {
    expect(isHighRiskPrediction("tickets", 0.70)).toBe(false);
    expect(isHighRiskPrediction("tickets", 0.50)).toBe(false);
  });

  it("returns true for delay risk > 0.80 (tasks domain)", () => {
    expect(isHighRiskPrediction("tasks", 0.85)).toBe(true);
    expect(isHighRiskPrediction("tasks", 0.81)).toBe(true);
  });

  it("returns false for delay risk <= 0.80 (tasks domain)", () => {
    expect(isHighRiskPrediction("tasks", 0.80)).toBe(false);
    expect(isHighRiskPrediction("tasks", 0.60)).toBe(false);
  });

  it("returns true for anomaly severity high (transactions domain)", () => {
    expect(isHighRiskPrediction("transactions", 0.90, "high")).toBe(true);
  });

  it("returns false for anomaly severity medium/low (transactions domain)", () => {
    expect(isHighRiskPrediction("transactions", 0.90, "medium")).toBe(false);
    expect(isHighRiskPrediction("transactions", 0.90, "low")).toBe(false);
  });

  it("returns false when prediction is null", () => {
    expect(isHighRiskPrediction("tickets", null)).toBe(false);
    expect(isHighRiskPrediction("tasks", null)).toBe(false);
  });

  it("returns false for non-triggering domains (leads, inventory, subscriptions)", () => {
    expect(isHighRiskPrediction("leads", 0.99)).toBe(false);
    expect(isHighRiskPrediction("inventory", 0.99)).toBe(false);
    expect(isHighRiskPrediction("subscriptions", 0.99)).toBe(false);
  });
});

// ─── 2. classifyPredictionStatus — search facet classification ───────────────

describe("classifyPredictionStatus", () => {
  it("returns 'anomaly-flagged' for high-severity transaction anomalies", () => {
    expect(classifyPredictionStatus("transactions", 0.90, 0.85, "high")).toBe("anomaly-flagged");
  });

  it("returns 'at-risk' for breach probability > 0.70", () => {
    expect(classifyPredictionStatus("tickets", 0.75, 0.80)).toBe("at-risk");
  });

  it("returns 'at-risk' for delay risk > 0.80", () => {
    expect(classifyPredictionStatus("tasks", 0.85, 0.70)).toBe("at-risk");
  });

  it("returns 'at-risk' for churn risk > 0.70", () => {
    expect(classifyPredictionStatus("subscriptions", 0.75, 0.80)).toBe("at-risk");
  });

  it("returns 'high-confidence' for confident non-risky predictions", () => {
    expect(classifyPredictionStatus("leads", 0.60, 0.85)).toBe("high-confidence");
  });

  it("returns 'normal' for low confidence non-risky predictions", () => {
    expect(classifyPredictionStatus("leads", 0.50, 0.40)).toBe("normal");
  });

  it("returns 'normal' for null predictions", () => {
    expect(classifyPredictionStatus("tickets", null, 0)).toBe("normal");
  });
});

// ─── 3. Workflow Task Emission ───────────────────────────────────────────────

describe("emitWorkflowTaskOnHighRisk", () => {
  it("emits workflow.instance.create for high breach risk prediction", async () => {
    const event = buildPredictionEvent({ domain: "tickets", prediction: 0.85 });
    const result = await emitWorkflowTaskOnHighRisk(event);

    expect(result).toBe(true);
    expect(enqueuedMessages).toHaveLength(1);
    expect(enqueuedMessages[0]!.topic).toBe(WORKFLOW_INSTANCE_CREATE);

    const payload = enqueuedMessages[0]!.payload as Record<string, unknown>;
    expect(payload.tenantId).toBe("tenant-001");
    expect(payload.definitionKey).toBe("ml-breach-risk-review");
    expect(payload.businessKey).toBe("ml-risk:tickets:entity-001");
    const variables = payload.variables as Record<string, unknown>;
    expect(variables.entityId).toBe("entity-001");
    expect(variables.prediction).toBe(0.85);
    expect(variables.responsibleRole).toBe("helpdesk_manager");
  });

  it("emits workflow.instance.create for high delay risk prediction", async () => {
    const event = buildPredictionEvent({ domain: "tasks", prediction: 0.90 });
    const result = await emitWorkflowTaskOnHighRisk(event);

    expect(result).toBe(true);
    expect(enqueuedMessages).toHaveLength(1);

    const payload = enqueuedMessages[0]!.payload as Record<string, unknown>;
    expect(payload.definitionKey).toBe("ml-delay-risk-review");
    const variables = payload.variables as Record<string, unknown>;
    expect(variables.responsibleRole).toBe("project_manager");
  });

  it("emits workflow.instance.create for high-severity anomaly", async () => {
    const event = buildPredictionEvent({ domain: "transactions", prediction: 0.95, anomalySeverity: "high" });
    const result = await emitWorkflowTaskOnHighRisk(event);

    expect(result).toBe(true);
    expect(enqueuedMessages).toHaveLength(1);

    const payload = enqueuedMessages[0]!.payload as Record<string, unknown>;
    expect(payload.definitionKey).toBe("ml-anomaly-review");
    const variables = payload.variables as Record<string, unknown>;
    expect(variables.responsibleRole).toBe("audit_officer");
  });

  it("does NOT emit workflow command for below-threshold predictions", async () => {
    const event = buildPredictionEvent({ domain: "tickets", prediction: 0.65 });
    const result = await emitWorkflowTaskOnHighRisk(event);

    expect(result).toBe(false);
    expect(enqueuedMessages).toHaveLength(0);
  });

  it("does NOT emit workflow command for null predictions", async () => {
    const event = buildPredictionEvent({ prediction: null });
    const result = await emitWorkflowTaskOnHighRisk(event);

    expect(result).toBe(false);
    expect(enqueuedMessages).toHaveLength(0);
  });
});

// ─── 4. Search Index Integration ─────────────────────────────────────────────

describe("indexPredictionStatusInSearch", () => {
  it("indexes at-risk status for high breach probability", async () => {
    const event = buildPredictionEvent({ domain: "tickets", prediction: 0.80, confidence: 0.85 });
    const result = await indexPredictionStatusInSearch(event);

    expect(result).toBe(true);
    expect(enqueuedMessages).toHaveLength(1);
    expect(enqueuedMessages[0]!.topic).toBe(SEARCH_INDEX_UPDATE);

    const payload = enqueuedMessages[0]!.payload as Record<string, unknown>;
    expect(payload.entityId).toBe("entity-001");
    const facets = payload.facets as Record<string, string>;
    expect(facets.predictionStatus).toBe("at-risk");
    expect(facets.predictionDomain).toBe("tickets");
  });

  it("indexes anomaly-flagged status for high-severity anomalies", async () => {
    const event = buildPredictionEvent({ domain: "transactions", prediction: 0.90, anomalySeverity: "high" });
    const result = await indexPredictionStatusInSearch(event);

    expect(result).toBe(true);
    const payload = enqueuedMessages[0]!.payload as Record<string, unknown>;
    const facets = payload.facets as Record<string, string>;
    expect(facets.predictionStatus).toBe("anomaly-flagged");
  });

  it("indexes high-confidence status for confident non-risky predictions", async () => {
    const event = buildPredictionEvent({ domain: "leads", prediction: 0.60, confidence: 0.85 });
    const result = await indexPredictionStatusInSearch(event);

    expect(result).toBe(true);
    const payload = enqueuedMessages[0]!.payload as Record<string, unknown>;
    const facets = payload.facets as Record<string, string>;
    expect(facets.predictionStatus).toBe("high-confidence");
  });

  it("does NOT index normal predictions", async () => {
    const event = buildPredictionEvent({ domain: "leads", prediction: 0.40, confidence: 0.30 });
    const result = await indexPredictionStatusInSearch(event);

    expect(result).toBe(false);
    expect(enqueuedMessages).toHaveLength(0);
  });
});

// ─── 5. Plugin Event Publishing ──────────────────────────────────────────────

describe("publishPredictionEventToPlugins", () => {
  it("publishes ml.prediction.* events to plugin service", async () => {
    const event = buildPredictionEvent();
    const result = await publishPredictionEventToPlugins(event, "ml.prediction.breach_risk_high");

    expect(result).toBe(true);
    expect(enqueuedMessages).toHaveLength(1);
    expect(enqueuedMessages[0]!.topic).toBe("plugin.event.ml.prediction.breach_risk_high");

    const payload = enqueuedMessages[0]!.payload as Record<string, unknown>;
    expect(payload.tenantId).toBe("tenant-001");
    expect(payload.entityId).toBe("entity-001");
    expect(payload.originalTopic).toBe("ml.prediction.breach_risk_high");
  });

  it("publishes different ml.prediction.* event types", async () => {
    const event = buildPredictionEvent({ domain: "leads" });
    const result = await publishPredictionEventToPlugins(event, "ml.prediction.lead_scored");

    expect(result).toBe(true);
    expect(enqueuedMessages[0]!.topic).toBe("plugin.event.ml.prediction.lead_scored");
  });

  it("does NOT publish non-ml.prediction.* events", async () => {
    const event = buildPredictionEvent();
    const result = await publishPredictionEventToPlugins(event, "ml.model.promoted");

    expect(result).toBe(false);
    expect(enqueuedMessages).toHaveLength(0);
  });

  it("does NOT publish unrelated events", async () => {
    const event = buildPredictionEvent();
    const result = await publishPredictionEventToPlugins(event, "crm.lead.updated");

    expect(result).toBe(false);
    expect(enqueuedMessages).toHaveLength(0);
  });
});

// ─── 6. Audit Event Recording ────────────────────────────────────────────────

describe("recordAuditEvent", () => {
  it("records audit event with correct fields for model operations", async () => {
    const result = await recordAuditEvent({
      tenantId: "tenant-001",
      actorId: "user-001",
      action: "model.promoted",
      resourceType: "ml-model",
      resourceId: "model-001",
      reason: "Model v3 promoted — AUC-ROC improved by 5%",
      metadata: { domain: "leads", version: 3 },
    });

    expect(result).toBe(true);
    expect(enqueuedMessages).toHaveLength(1);
    expect(enqueuedMessages[0]!.topic).toBe(AUDIT_EVENT_RECORD);
    expect(enqueuedMessages[0]!.tenantId).toBe("tenant-001");
    expect(enqueuedMessages[0]!.actorId).toBe("user-001");

    const payload = enqueuedMessages[0]!.payload as Record<string, unknown>;
    expect(payload.service).toBe("ml");
    expect(payload.action).toBe("model.promoted");
    expect(payload.resourceType).toBe("ml-model");
    expect(payload.resourceId).toBe("model-001");
    expect(payload.reason).toBe("Model v3 promoted — AUC-ROC improved by 5%");
    expect(payload.retentionDays).toBe(PREDICTION_LOG_RETENTION_DAYS);
    expect(payload.outcome).toBe("success");
    expect(payload.timestamp).toBeDefined();
  });

  it("sets retentionDays to 180 for CERT-In compliance", async () => {
    await recordAuditEvent({
      tenantId: "tenant-001",
      actorId: "user-001",
      action: "model.deactivated",
      resourceType: "ml-model",
      resourceId: "model-002",
      reason: "Quality degradation",
    });

    const payload = enqueuedMessages[0]!.payload as Record<string, unknown>;
    expect(payload.retentionDays).toBe(180);
  });
});

// ─── 7. Audit Convenience Functions ─────────────────────────────────────────

describe("audit convenience functions", () => {
  it("auditTrainingStarted records correct event", async () => {
    const result = await auditTrainingStarted("tenant-001", "system", "run-001", "leads");

    expect(result).toBe(true);
    const payload = enqueuedMessages[0]!.payload as Record<string, unknown>;
    expect(payload.action).toBe("model.training.started");
    expect(payload.resourceType).toBe("ml-training-run");
    expect(payload.resourceId).toBe("run-001");
  });

  it("auditTrainingCompleted records metrics in metadata", async () => {
    const result = await auditTrainingCompleted("tenant-001", "system", "run-001", "leads", { aucRoc: 0.85 });

    expect(result).toBe(true);
    const payload = enqueuedMessages[0]!.payload as Record<string, unknown>;
    expect(payload.action).toBe("model.training.completed");
    const metadata = payload.metadata as Record<string, unknown>;
    expect(metadata.metrics).toEqual({ aucRoc: 0.85 });
  });

  it("auditTrainingFailed records error message", async () => {
    const result = await auditTrainingFailed("tenant-001", "system", "run-001", "leads", "Timeout exceeded");

    expect(result).toBe(true);
    const payload = enqueuedMessages[0]!.payload as Record<string, unknown>;
    expect(payload.action).toBe("model.training.failed");
    const metadata = payload.metadata as Record<string, unknown>;
    expect(metadata.errorMessage).toBe("Timeout exceeded");
  });

  it("auditModelPromoted records domain and version", async () => {
    const result = await auditModelPromoted("tenant-001", "admin-001", "model-003", "tickets", 5);

    expect(result).toBe(true);
    expect(enqueuedMessages[0]!.actorId).toBe("admin-001");
    const payload = enqueuedMessages[0]!.payload as Record<string, unknown>;
    expect(payload.action).toBe("model.promoted");
    expect(payload.resourceType).toBe("ml-model");
    const metadata = payload.metadata as Record<string, unknown>;
    expect(metadata.domain).toBe("tickets");
    expect(metadata.version).toBe(5);
  });

  it("auditModelDeactivated records reason", async () => {
    const result = await auditModelDeactivated("tenant-001", "system", "model-003", "tickets", "3 consecutive failures below threshold");

    expect(result).toBe(true);
    const payload = enqueuedMessages[0]!.payload as Record<string, unknown>;
    expect(payload.action).toBe("model.deactivated");
    expect(payload.reason).toBe("3 consecutive failures below threshold");
  });

  it("auditExperimentCreated records experiment details", async () => {
    const result = await auditExperimentCreated("tenant-001", "admin-001", "exp-001", "leads", "Lead Scoring v4 Test");

    expect(result).toBe(true);
    const payload = enqueuedMessages[0]!.payload as Record<string, unknown>;
    expect(payload.action).toBe("experiment.created");
    expect(payload.resourceType).toBe("ml-experiment");
    const metadata = payload.metadata as Record<string, unknown>;
    expect(metadata.name).toBe("Lead Scoring v4 Test");
  });

  it("auditExperimentEnded records outcome", async () => {
    const result = await auditExperimentEnded("tenant-001", "admin-001", "exp-001", "leads", "completed");

    expect(result).toBe(true);
    const payload = enqueuedMessages[0]!.payload as Record<string, unknown>;
    expect(payload.action).toBe("experiment.ended");
  });

  it("auditExperimentEnded records cancelled outcome", async () => {
    const result = await auditExperimentEnded("tenant-001", "admin-001", "exp-001", "leads", "cancelled");

    expect(result).toBe(true);
    const payload = enqueuedMessages[0]!.payload as Record<string, unknown>;
    expect(payload.action).toBe("experiment.cancelled");
  });
});

// ─── 8. processPredictionEvent (Orchestrator) ────────────────────────────────

describe("processPredictionEvent", () => {
  it("processes high-risk prediction through all integrations", async () => {
    const event = buildPredictionEvent({ domain: "tickets", prediction: 0.85, confidence: 0.90 });
    const result = await processPredictionEvent(event, "ml.prediction.breach_risk_high");

    expect(result.workflowEmitted).toBe(true);
    expect(result.searchIndexed).toBe(true);
    expect(result.pluginPublished).toBe(true);

    // Verify all three messages were enqueued
    const topics = enqueuedMessages.map((m) => m.topic);
    expect(topics).toContain(WORKFLOW_INSTANCE_CREATE);
    expect(topics).toContain(SEARCH_INDEX_UPDATE);
    expect(topics).toContain("plugin.event.ml.prediction.breach_risk_high");
  });

  it("processes normal prediction — only search/plugin may fire", async () => {
    const event = buildPredictionEvent({ domain: "leads", prediction: 0.50, confidence: 0.85 });
    const result = await processPredictionEvent(event, "ml.prediction.lead_scored");

    // Leads at 0.50 is not high-risk, but confidence > 0.70 → high-confidence in search
    expect(result.workflowEmitted).toBe(false);
    expect(result.searchIndexed).toBe(true);
    expect(result.pluginPublished).toBe(true);
  });

  it("processes low-confidence prediction — minimal integrations", async () => {
    const event = buildPredictionEvent({ domain: "leads", prediction: 0.30, confidence: 0.25 });
    const result = await processPredictionEvent(event, "ml.prediction.lead_scored");

    expect(result.workflowEmitted).toBe(false);
    expect(result.searchIndexed).toBe(false); // "normal" status — not indexed
    expect(result.pluginPublished).toBe(true); // still published to plugins
  });
});

// ─── 9. Constants Verification ───────────────────────────────────────────────

describe("constants", () => {
  it("PREDICTION_LOG_RETENTION_DAYS is 180 (CERT-In)", () => {
    expect(PREDICTION_LOG_RETENTION_DAYS).toBe(180);
  });

  it("DEFAULT_THRESHOLDS match specification", () => {
    expect(DEFAULT_THRESHOLDS.breachProbability).toBe(0.70);
    expect(DEFAULT_THRESHOLDS.delayRisk).toBe(0.80);
    expect(DEFAULT_THRESHOLDS.anomalySeverities).toContain("high");
  });
});
