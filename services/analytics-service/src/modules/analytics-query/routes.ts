/**
 * Analytics Query Routes
 *
 * POST /v1/analytics/query      — Execute joins + calculated fields query
 * GET  /v1/analytics/drill-through/:reportId/:cellId — Drill-through detail rows
 */
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { registerErrorHandler } from "../../shared/errors.js";
import { db } from "../../shared/db.js";
import { analyticsQueryBody, drillThroughParams, drillThroughQuery } from "./validators.js";
import { executeAnalyticsQuery, executeDrillThrough } from "./executor.js";
import { CalcFieldError, JoinError, DrillThroughError } from "./domain.js";
import { RegistryError } from "../registry/registry.js";

const ROLES = ["analytics_user", "analytics_admin", "tenant_admin", "super_admin"];

export async function analyticsQueryRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /v1/analytics/query
   *
   * Execute an analytics query with optional cross-table joins and calculated fields.
   * Returns aggregated results capped at 1000 rows.
   */
  app.post("/v1/analytics/query", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);

    const body = analyticsQueryBody.parse(req.body);

    try {
      const result = await executeAnalyticsQuery(db, ctx.tenantId, body);
      return reply.code(200).send({ data: result });
    } catch (err) {
      if (err instanceof CalcFieldError) {
        throw new HttpError(400, err.code, err.message);
      }
      if (err instanceof JoinError) {
        throw new HttpError(400, err.code, err.message);
      }
      if (err instanceof RegistryError) {
        throw new HttpError(400, err.code, err.message);
      }
      throw err;
    }
  });

  /**
   * GET /v1/analytics/drill-through/:reportId/:cellId
   *
   * Navigate from an aggregated metric cell to the underlying detail rows.
   * Returns detail rows capped at 200, always tenant-scoped.
   */
  app.get("/v1/analytics/drill-through/:reportId/:cellId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);

    const params = drillThroughParams.parse(req.params);
    const query = drillThroughQuery.parse(req.query);

    try {
      const result = await executeDrillThrough(
        db,
        ctx.tenantId,
        params.reportId,
        params.cellId,
        query.limit,
        query.offset,
      );
      return reply.code(200).send({ data: result });
    } catch (err) {
      if (err instanceof DrillThroughError) {
        if (err.code === "REPORT_NOT_FOUND") {
          throw new HttpError(404, err.code, err.message);
        }
        if (err.code === "REPORT_NOT_READY") {
          throw new HttpError(409, err.code, err.message);
        }
        throw new HttpError(400, err.code, err.message);
      }
      if (err instanceof RegistryError) {
        throw new HttpError(400, err.code, err.message);
      }
      throw err;
    }
  });

  registerErrorHandler(app);
}
