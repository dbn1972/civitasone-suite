/**
 * Demand Forecasting Routes — GET /v1/inventory/items/:id/forecast
 *
 * Produces 30/60/90-day demand forecasts per item per warehouse combination.
 * Calls ml-service internally via HTTP for trained model predictions;
 * falls back to simple moving average when no model is available.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7
 */
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, registerErrorHandler } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { enqueue } from "../../shared/outbox.js";
import { db } from "../../shared/db.js";
import { EVENTS } from "../../topics.js";
import { forecastParams, forecastQuery } from "./validators.js";
import { predictDemand } from "./ml-client.js";
import * as repo from "./repo.js";
import {
  MIN_MOVEMENT_RECORDS,
  computeFeatures,
  smaFallbackForecast,
  computeSafetyStock,
  computeReorderPoint,
  shouldReorder,
  type Horizon,
  type InsufficientDataResult,
  type DemandForecastResult,
} from "./domain.js";

const READER_ROLES = [
  "inventory_user", "inventory_manager", "inventory_admin", "store_keeper",
  "procurement_officer", "finance_officer", "super_admin", "tenant_admin",
];

export async function forecastRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/inventory/items/:id/forecast", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);

    const { id } = forecastParams.parse(req.params);
    const { warehouseId, horizon } = forecastQuery.parse(req.query);

    // 1. Get item metadata (lead time)
    const meta = await repo.getItemForecastMeta(ctx.tenantId, id);
    if (!meta) {
      return reply.code(200).send({ forecast: null, reason: "item_not_found" });
    }

    // 2. Check minimum data threshold (30 movement records)
    const movementCount = await repo.countMovements(ctx.tenantId, id, warehouseId);
    if (movementCount < MIN_MOVEMENT_RECORDS) {
      const result: InsufficientDataResult = { forecast: null, reason: "insufficient_data" };
      return reply.send(result);
    }

    // 3. Get daily movements for feature computation
    const dailyMovements = await repo.getDailyMovements(ctx.tenantId, id, warehouseId, 90);
    const features = computeFeatures(dailyMovements, meta.leadTimeDays);

    // 4. Attempt ML-service prediction (exponential smoothing)
    const mlResponse = await predictDemand({
      tenantId: ctx.tenantId,
      domain: "inventory",
      entityId: id,
      features: {
        avgDailyMovement30d: features.avgDailyMovement30d,
        avgDailyMovement90d: features.avgDailyMovement90d,
        stdDevMovement90d: features.stdDevMovement90d,
        leadTimeDays: features.leadTimeDays,
        seasonalityIndex: features.seasonalityIndex,
      },
    });

    let result: DemandForecastResult;
    let modelSource: "ml" | "sma";

    if (mlResponse && !mlResponse.fallback && mlResponse.dailyForecast && mlResponse.dailyForecast.length > 0) {
      // ML-service returned a trained model forecast — use it
      const dailyForecast = mlResponse.dailyForecast.slice(0, horizon);
      // Pad if ml-service returned fewer days than requested horizon
      while (dailyForecast.length < horizon) {
        dailyForecast.push(dailyForecast[dailyForecast.length - 1] ?? 0);
      }
      const totalDemand = Math.round(dailyForecast.reduce((s, v) => s + v, 0));
      const safetyStock = computeSafetyStock(features.stdDevMovement90d);
      const reorderPoint = computeReorderPoint(features.avgDailyMovement90d, meta.leadTimeDays, safetyStock);

      result = {
        dailyForecast,
        totalDemand,
        safetyStock,
        reorderPoint,
        confidence: mlResponse.confidence,
      };
      modelSource = "ml";
    } else {
      // Fallback: compute SMA forecast
      result = smaFallbackForecast(features, horizon as Horizon);
      modelSource = "sma";
    }

    // 5. Check if reorder point is crossed → emit stockout risk event
    if (shouldReorder(result.dailyForecast, meta.leadTimeDays, 0, result.reorderPoint)) {
      // Emit via outbox in a lightweight transaction
      try {
        await db.transaction(async (tx) => {
          await enqueue(tx as Parameters<typeof enqueue>[0], {
            topic: "ml.prediction.stockout_risk",
            eventType: "ml.prediction.stockout_risk",
            tenantId: ctx.tenantId,
            actorId: ctx.actorId,
            correlationId: req.id,
            payload: {
              tenantId: ctx.tenantId,
              domain: "inventory",
              entityId: id,
              warehouseId: warehouseId ?? null,
              reorderPoint: result.reorderPoint,
              forecastedDemand: result.totalDemand,
              safetyStock: result.safetyStock,
              confidence: result.confidence,
              timestamp: new Date().toISOString(),
            },
          });
        });
      } catch (err) {
        // Non-critical: log but don't fail the response
        req.log.warn({ err, itemId: id }, "failed to emit stockout_risk event");
      }
    }

    return reply.send({ ...result, modelSource });
  });

  registerErrorHandler(app);
}
