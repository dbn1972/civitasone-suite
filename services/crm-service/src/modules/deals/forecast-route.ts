/**
 * Forecast route — GET /v1/crm/forecast
 * Computes weighted revenue forecast from active deals.
 *
 * Validates: Requirements 8.4
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { deals } from "./schema.js";
import { pipelines, type PipelineStage } from "../pipelines/schema.js";
import { weightedForecast, weightedForecastByStage, type DealForForecast } from "./forecast.js";
import { eq, and, sql } from "drizzle-orm";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin"];

const forecastQuerySchema = z.object({
  pipelineId: z.string().uuid().optional(),
});

export async function forecastRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /v1/crm/forecast
   * Returns weighted revenue forecast computed from active deals.
   * Optionally filtered by pipeline.
   */
  app.get("/v1/crm/forecast", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const query = forecastQuerySchema.parse(req.query);

    // Fetch active deals for this tenant
    const conditions = [
      eq(deals.tenantId, ctx.tenantId),
      sql`${deals.status} = 'active'`,
    ];
    if (query.pipelineId) {
      conditions.push(eq(deals.pipelineId, query.pipelineId));
    }

    const activeDeals = await db.select({
      id: deals.id,
      stageId: deals.stageId,
      valueMinor: deals.valueMinor,
      pipelineId: deals.pipelineId,
    })
      .from(deals)
      .where(and(...conditions));

    // Fetch all pipelines for this tenant to build stage probabilities map
    const pipelineRows = await db.select({
      id: pipelines.id,
      stages: pipelines.stages,
    })
      .from(pipelines)
      .where(and(eq(pipelines.tenantId, ctx.tenantId), eq(pipelines.status, "active")));

    // Build stageId → probability map from all pipeline stages
    const stageProbabilities = new Map<string, number>();
    for (const pipeline of pipelineRows) {
      const stages = pipeline.stages as PipelineStage[];
      for (const stage of stages) {
        stageProbabilities.set(stage.id, stage.probability);
      }
    }

    // Filter deals that have a valid stageId
    const dealsForForecast: DealForForecast[] = activeDeals
      .filter((d) => d.stageId != null)
      .map((d) => ({
        id: d.id,
        stageId: d.stageId!,
        valueMinor: d.valueMinor,
      }));

    const totalForecast = weightedForecast(dealsForForecast, stageProbabilities);
    const byStage = weightedForecastByStage(dealsForForecast, stageProbabilities);

    // Build stage breakdown with names
    const stageBreakdown: Array<{ stageId: string; stageName: string; probability: number; weightedTotal: string }> = [];
    for (const [stageId, weightedTotal] of byStage) {
      // Find stage name from pipelines
      let stageName = "Unknown";
      let probability = 0;
      for (const pipeline of pipelineRows) {
        const stages = pipeline.stages as PipelineStage[];
        const stage = stages.find((s) => s.id === stageId);
        if (stage) {
          stageName = stage.name;
          probability = stage.probability;
          break;
        }
      }
      stageBreakdown.push({
        stageId,
        stageName,
        probability,
        weightedTotal: weightedTotal.toString(),
      });
    }

    return reply.send({
      data: {
        totalForecast: totalForecast.toString(),
        dealCount: dealsForForecast.length,
        stages: stageBreakdown,
      },
    });
  });
}
