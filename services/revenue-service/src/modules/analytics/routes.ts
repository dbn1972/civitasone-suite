/**
 * Analytics routes — revenue trends, efficiency, arrears aging, defaulters,
 * and the forecasting engine.
 *
 * All money is serialised as decimal strings (bigint paise) — never floats.
 *
 * _Requirements: SVC-140_
 */
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { granularityQuery, agingQuery, defaultersQuery, forecastBody } from "./validators.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { forecast, DomainError, type ForecastResult } from "./domain.js";

const READ_ROLES = ["revenue_admin", "revenue_officer", "revenue_analyst", "finance_admin", "super_admin", "tenant_admin"];
const FORECAST_ROLES = ["revenue_admin", "revenue_analyst", "finance_admin", "super_admin", "tenant_admin"];

function serialiseForecast(result: ForecastResult) {
  return {
    method: result.method,
    historyPeriods: result.historyPeriods,
    horizon: result.horizon,
    madMinor: result.madMinor.toString(),
    confidenceBps: result.confidenceBps,
    projections: result.projections.map((p) => ({
      index: p.index,
      projectionMinor: p.projectionMinor.toString(),
      lowerMinor: p.lowerMinor.toString(),
      upperMinor: p.upperMinor.toString(),
    })),
  };
}

export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: { code: "VALIDATION_FAILED", message: error.message } });
    }
    if (error instanceof HttpError) {
      return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof DomainError) {
      return reply.code(422).send({ error: { code: error.code, message: error.message } });
    }
    return reply.code(500).send({ error: { code: "INTERNAL", message: "internal server error" } });
  });

  // ── GET /v1/revenue/analytics/trends ──────────────────────────────────────
  app.get("/v1/revenue/analytics/trends", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { granularity } = granularityQuery.parse(req.query);
    const trends = await repo.getTrends(ctx.tenantId, granularity);
    return reply.send({
      data: trends.map((t) => ({
        period: t.period,
        demandMinor: t.demandMinor.toString(),
        collectionMinor: t.collectionMinor.toString(),
        efficiencyBps: t.efficiencyBps,
      })),
      meta: { granularity },
    });
  });

  // ── GET /v1/revenue/analytics/efficiency ──────────────────────────────────
  app.get("/v1/revenue/analytics/efficiency", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { granularity } = granularityQuery.parse(req.query);
    const kpi = await repo.getEfficiency(ctx.tenantId, granularity);
    return reply.send({
      data: {
        totalDemandMinor: kpi.totalDemandMinor.toString(),
        totalCollectionMinor: kpi.totalCollectionMinor.toString(),
        efficiencyBps: kpi.efficiencyBps,
        perPeriod: kpi.perPeriod.map((t) => ({
          period: t.period,
          demandMinor: t.demandMinor.toString(),
          collectionMinor: t.collectionMinor.toString(),
          efficiencyBps: t.efficiencyBps,
        })),
      },
      meta: { granularity },
    });
  });

  // ── GET /v1/revenue/analytics/arrears-aging ───────────────────────────────
  app.get("/v1/revenue/analytics/arrears-aging", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { asOf } = agingQuery.parse(req.query);
    const asOfDate = asOf ?? new Date().toISOString().slice(0, 10);
    const aging = await repo.getArrearsAging(ctx.tenantId, asOfDate);
    return reply.send({ data: aging, meta: { asOf: asOfDate } });
  });

  // ── GET /v1/revenue/analytics/defaulters ──────────────────────────────────
  app.get("/v1/revenue/analytics/defaulters", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { limit } = defaultersQuery.parse(req.query);
    const defaulters = await repo.getDefaulters(ctx.tenantId, limit);
    return reply.send({
      data: defaulters.map((d) => ({
        rank: d.rank,
        assesseeId: d.assesseeId,
        outstandingMinor: d.outstandingMinor.toString(),
      })),
      meta: { limit, count: defaulters.length },
    });
  });

  // ── POST /v1/revenue/analytics/forecast ───────────────────────────────────
  app.post("/v1/revenue/analytics/forecast", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FORECAST_ROLES);
    const body = forecastBody.parse(req.body ?? {});

    const series = await repo.getCollectionSeries(ctx.tenantId, body.granularity);
    const result = forecast(series, body.method, body.horizon, body.param);

    let runId: string | undefined;
    if (body.persist) {
      const saved = await commands.persistForecastRun(ctx, {
        method: body.method,
        granularity: body.granularity,
        param: body.param,
        rateHeadId: body.rateHeadId,
        series,
        result,
      });
      runId = saved.id;
    }

    return reply.send({
      data: {
        ...serialiseForecast(result),
        granularity: body.granularity,
        param: body.param,
        series: series.map((v) => v.toString()),
        ...(runId ? { runId } : {}),
      },
    });
  });
}
