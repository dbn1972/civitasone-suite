/**
 * Churn Risk & Revenue Forecast routes for billing-service.
 *
 * Routes:
 *   GET /v1/billing/subscriptions/:id/churn-risk
 *   GET /v1/billing/revenue/forecast?horizon=3|6|12
 *
 * Both routes call ml-service internally via the adapter.
 * Falls back to rule-based/linear extrapolation when ML is unavailable.
 *
 * Emits `ml.prediction.churn_risk_high` event when probability > 0.70.
 */

import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { CircuitBreakerOpenError } from "@civitasone/circuit-breaker";
import { resolveContext, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { subscriptionIdParam, revenueForecastQuery } from "./validators.js";
import { predictChurn } from "./adapter.js";
import {
  classifyRiskLevel,
  fallbackChurnScore,
  extractFeatures,
  computeRevenueForecast,
  computeCohortAnalysis,
  type SubscriptionFeatures,
  type ChurnRiskResult,
  type MrrDataPoint,
  type SubscriptionCohortInput,
  type RevenueForecastResult,
} from "./domain.js";

const CHURN_HIGH_EVENT = "ml.prediction.churn_risk_high";
const BILLING_ROLES = ["billing_admin", "finance_admin", "tenant_admin", "super_admin", "platform_admin"];

export async function churnRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /v1/billing/subscriptions/:id/churn-risk
   *
   * Returns churn probability, contributing factors, and risk level.
   * Falls back to rule-based scoring when ML is unavailable.
   */
  app.get("/v1/billing/subscriptions/:id/churn-risk", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = subscriptionIdParam.parse(req.params);

    // Extract features for this subscription (simulated — in production would query DB)
    const features = getSubscriptionFeatures(id);

    // Attempt ML prediction
    let result: ChurnRiskResult;
    let isFallback = false;

    try {
      const mlResponse = await predictChurn(ctx.tenantId, id, features as unknown as Record<string, number>);

      if (mlResponse && mlResponse.prediction !== null) {
        result = {
          probability: mlResponse.prediction,
          factors: mlResponse.factors,
          riskLevel: classifyRiskLevel(mlResponse.prediction),
        };
      } else {
        // ML returned null or disabled — use fallback
        isFallback = true;
        result = fallbackChurnScore(features);
      }
    } catch (err) {
      // On any error (circuit breaker open, timeout, etc.) — use fallback
      isFallback = true;
      result = fallbackChurnScore(features);
      req.log.warn({ err: (err as Error).message, subscriptionId: id }, "ml-service unavailable, using fallback churn score");
    }

    // Emit high-risk event when probability > 0.70
    if (result.riskLevel === "high") {
      await queue.publish(CHURN_HIGH_EVENT, {
        messageId: randomUUID(),
        type: CHURN_HIGH_EVENT,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId ?? req.id,
        schemaVersion: "1.0",
        payload: {
          tenantId: ctx.tenantId,
          domain: "subscriptions",
          entityId: id,
          prediction: result.probability,
          confidence: isFallback ? 0 : result.probability,
          factors: result.factors,
          timestamp: new Date().toISOString(),
        },
      });
    }

    return reply.send({
      data: {
        probability: result.probability,
        factors: result.factors,
        riskLevel: result.riskLevel,
        isFallback,
      },
    });
  });

  /**
   * GET /v1/billing/revenue/forecast?horizon=3|6|12
   *
   * Returns MRR projections accounting for churn and expansion.
   * Falls back to linear extrapolation of past 6-month trend.
   */
  app.get("/v1/billing/revenue/forecast", async (req, reply) => {
    const ctx = resolveContext(req);
    const { horizon } = revenueForecastQuery.parse(req.query);
    const horizonMonths = Number(horizon) as 3 | 6 | 12;

    // In production, these would come from database queries
    const mrrHistory = getMrrHistory(ctx.tenantId);
    const churnRateMonthly = getMonthlyChurnRate(ctx.tenantId);
    const expansionRateMonthly = getMonthlyExpansionRate(ctx.tenantId);

    const forecast = computeRevenueForecast(
      mrrHistory,
      horizonMonths,
      churnRateMonthly,
      expansionRateMonthly,
    );

    return reply.send({
      data: {
        currentMrr: forecast.currentMrr,
        projectedMrr: forecast.projectedMrr,
        churnImpact: forecast.churnImpact,
        expansionImpact: forecast.expansionImpact,
        cashFlowProjection: forecast.cashFlowProjection,
      },
    });
  });

  /**
   * GET /v1/billing/revenue/cohorts
   *
   * Returns cohort analysis and retention curves.
   */
  app.get("/v1/billing/revenue/cohorts", async (req, reply) => {
    const ctx = resolveContext(req);

    const subscriptions = getCohortData(ctx.tenantId);
    const cohorts = computeCohortAnalysis(subscriptions);

    return reply.send({ data: { cohorts } });
  });

  // Error handler for this plugin scope
  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: { code: "VALIDATION_FAILED", message: "invalid request parameters", correlationId } });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, correlationId } });
    }
    if (err instanceof CircuitBreakerOpenError) {
      return reply.code(503).send({ error: { code: "ML_UNAVAILABLE", message: "prediction service temporarily unavailable", correlationId } });
    }
    req.log.error({ err }, "unhandled error in churn routes");
    return reply.code(500).send({ error: { code: "INTERNAL", message: "internal error", correlationId } });
  });
}

// ── Data Access Stubs ─────────────────────────────────────────────
// In production, these query the database. Stubbed here for testability.

/**
 * Get subscription features for churn scoring.
 * In production, queries billing DB + cross-service data.
 */
function getSubscriptionFeatures(_subscriptionId: string): SubscriptionFeatures {
  // Default features — in production these come from DB/cache
  return {
    paymentDelayAvgDays: 0,
    supportTicketCount90d: 0,
    daysSinceLastLogin: 7,
    usageScore: 70,
    tenureDays: 180,
  };
}

/**
 * Get MRR history for revenue forecast.
 * Returns last 6 months of MRR data.
 */
function getMrrHistory(_tenantId: string): MrrDataPoint[] {
  // Stub: generate 6-month history for demonstration
  const now = new Date();
  const points: MrrDataPoint[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - i);
    points.push({
      month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`,
      mrr: 1000000 + (5 - i) * 50000, // growing from 10L to 12.5L paise
    });
  }
  return points;
}

/** Get monthly churn rate (stub). */
function getMonthlyChurnRate(_tenantId: string): number {
  return 0.03; // 3% monthly churn
}

/** Get monthly expansion rate (stub). */
function getMonthlyExpansionRate(_tenantId: string): number {
  return 0.05; // 5% monthly expansion
}

/** Get cohort data for retention analysis (stub). */
function getCohortData(_tenantId: string): SubscriptionCohortInput[] {
  return [];
}
