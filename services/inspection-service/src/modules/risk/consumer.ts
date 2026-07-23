/**
 * inspection-service: risk module — SQS/RabbitMQ consumer.
 *
 * Handles risk model configuration and score computation commands:
 *   - riskModelConfigure: validate weight sum → insert model → emit event → audit
 *   - riskScoreCompute: fetch model → compute score → store (with previousScore) → emit event → audit
 *   - riskScoreBatchCompute: iterate entities → compute each → store → emit events
 *
 * All handlers follow the idempotency pattern:
 *   markProcessed(tx, msg.messageId) → write → enqueue event → cache invalidate
 *
 * _Requirements: 3.1, 3.2, 3.3_
 */
import { pino } from "pino";
import { NonRetryableError, type Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { validateWeightSum, computeRiskScore, type RiskFactor } from "./domain.js";
import * as repo from "./repo.js";

const log = pino({ name: "risk-consumer" });

// ── Payload types ─────────────────────────────────────────────────────────────

interface RiskModelConfigurePayload {
  tenantId: string;
  name: string;
  description?: string;
  factors: Array<{
    factorName: string;
    weight: number;
    scoringFunction: string;
    dataSource: string;
  }>;
}

interface RiskScoreComputePayload {
  tenantId: string;
  entityId: string;
  modelId?: string;
}

interface RiskScoreBatchComputePayload {
  tenantId: string;
  entityIds?: string[];
  modelId?: string;
  riskCategoryFilter?: string;
}

// ── Registration ──────────────────────────────────────────────────────────────

export function registerRiskConsumers(queue: Queue): void {
  // ─── riskModelConfigure ───────────────────────────────────────────────
  queue.subscribe<RiskModelConfigurePayload>(COMMANDS.riskModelConfigure, async (msg) => {
    const p = msg.payload;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Convert payload factors to domain RiskFactor shape for validation.
      const factors: RiskFactor[] = p.factors.map((f) => ({
        name: f.factorName,
        weight: f.weight,
        scoringFunction: f.scoringFunction,
        dataSource: f.dataSource,
      }));

      // Validate weight sum — throws DomainError if invalid (non-retryable).
      try {
        validateWeightSum(factors);
      } catch (err) {
        throw new NonRetryableError((err as Error).message);
      }

      // Persist the model.
      const model = await repo.insertModel(tx, {
        tenantId: msg.tenantId,
        name: p.name,
        description: p.description ?? null,
        factors: p.factors,
        isActive: 1,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      // Enqueue domain event via transactional outbox.
      await enqueue(tx, {
        topic: EVENTS.riskScoreComputed,
        eventType: "inspection.risk_model.configured",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { modelId: model.id, name: model.name, factorCount: p.factors.length },
      });

      // Invalidate risk model cache for this tenant.
      await cache.invalidateResourceAfterCommit(tx, msg.tenantId, "risk_model");

      log.info(
        { event: "risk_model_configured", modelId: model.id, tenantId: msg.tenantId },
        "risk model configured",
      );
    });
  });

  // ─── riskScoreCompute ─────────────────────────────────────────────────
  queue.subscribe<RiskScoreComputePayload>(COMMANDS.riskScoreCompute, async (msg) => {
    const p = msg.payload;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Resolve the risk model (explicit or active default).
      const model = p.modelId
        ? await repo.findModelById(msg.tenantId, p.modelId)
        : await repo.findActiveModelByTenant(msg.tenantId);

      if (!model) {
        throw new NonRetryableError(
          `No risk model found${p.modelId ? ` with id ${p.modelId}` : " (no active model for tenant)"}`,
        );
      }

      // Build RiskFactor array from stored model factors.
      const factors: RiskFactor[] = (model.factors as Array<{
        factorName: string;
        weight: number;
        scoringFunction: string;
        dataSource: string;
      }>).map((f) => ({
        name: f.factorName,
        weight: f.weight,
        scoringFunction: f.scoringFunction,
        dataSource: f.dataSource,
      }));

      // For now, raw scores default to 50 (neutral) until data source integration.
      // Future: fetch actual raw scores from each factor's data source.
      const rawScores = new Map<string, number>();
      for (const factor of factors) {
        rawScores.set(factor.name, 50);
      }

      const result = computeRiskScore(factors, rawScores);

      // Fetch previous score for trend tracking.
      const previousRecord = await repo.findScoreByEntity(msg.tenantId, p.entityId);
      const previousScore = previousRecord?.score ?? null;

      // Persist the computed score.
      await repo.insertScore(tx, {
        tenantId: msg.tenantId,
        entityId: p.entityId,
        modelId: model.id,
        score: result.score,
        factorBreakdown: result.breakdown,
        previousScore,
        createdBy: msg.actorId,
      });

      // Emit riskScoreComputed event.
      await enqueue(tx, {
        topic: EVENTS.riskScoreComputed,
        eventType: EVENTS.riskScoreComputed,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          entityId: p.entityId,
          previousScore,
          newScore: result.score,
          modelId: model.id,
          factorBreakdown: result.breakdown,
          computedAt: new Date().toISOString(),
        },
      });

      // Invalidate cached score for this entity.
      await cache.invalidateResourceAfterCommit(tx, msg.tenantId, "risk_score");

      log.info(
        {
          event: "risk_score_computed",
          entityId: p.entityId,
          score: result.score,
          previousScore,
          modelId: model.id,
          tenantId: msg.tenantId,
        },
        "risk score computed",
      );
    });
  });

  // ─── riskScoreBatchCompute ────────────────────────────────────────────
  queue.subscribe<RiskScoreBatchComputePayload>(COMMANDS.riskScoreBatchCompute, async (msg) => {
    const p = msg.payload;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Resolve the risk model.
      const model = p.modelId
        ? await repo.findModelById(msg.tenantId, p.modelId)
        : await repo.findActiveModelByTenant(msg.tenantId);

      if (!model) {
        throw new NonRetryableError(
          `No risk model found${p.modelId ? ` with id ${p.modelId}` : " (no active model for tenant)"}`,
        );
      }

      const factors: RiskFactor[] = (model.factors as Array<{
        factorName: string;
        weight: number;
        scoringFunction: string;
        dataSource: string;
      }>).map((f) => ({
        name: f.factorName,
        weight: f.weight,
        scoringFunction: f.scoringFunction,
        dataSource: f.dataSource,
      }));

      // Determine entity list. If entityIds not provided, this batch is a no-op
      // (future: resolve from riskCategoryFilter via entity queries).
      const entityIds = p.entityIds ?? [];

      for (const entityId of entityIds) {
        // Compute raw scores (default 50 until data source integration).
        const rawScores = new Map<string, number>();
        for (const factor of factors) {
          rawScores.set(factor.name, 50);
        }

        const result = computeRiskScore(factors, rawScores);

        // Fetch previous score for trend tracking.
        const previousRecord = await repo.findScoreByEntity(msg.tenantId, entityId);
        const previousScore = previousRecord?.score ?? null;

        // Persist score.
        await repo.insertScore(tx, {
          tenantId: msg.tenantId,
          entityId,
          modelId: model.id,
          score: result.score,
          factorBreakdown: result.breakdown,
          previousScore,
          createdBy: msg.actorId,
        });

        // Emit event per entity.
        await enqueue(tx, {
          topic: EVENTS.riskScoreComputed,
          eventType: EVENTS.riskScoreComputed,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            entityId,
            previousScore,
            newScore: result.score,
            modelId: model.id,
            factorBreakdown: result.breakdown,
            computedAt: new Date().toISOString(),
          },
        });
      }

      // Invalidate cached scores for this tenant.
      if (entityIds.length > 0) {
        await cache.invalidateResourceAfterCommit(tx, msg.tenantId, "risk_score");
      }

      log.info(
        {
          event: "risk_score_batch_computed",
          entityCount: entityIds.length,
          modelId: model.id,
          tenantId: msg.tenantId,
        },
        "batch risk scores computed",
      );
    });
  });
}
