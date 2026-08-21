/**
 * Anomaly Detection Routes
 *
 * GET  /v1/finance/anomalies           — paginated list of flagged anomalies
 * PATCH /v1/finance/anomalies/:id/dismiss — dismiss with reason (requires audit_officer or finance_admin)
 *
 * Requirements: 11.6, 11.7
 */
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError, financeErrorHandler } from "../../shared/context.js";
import { anomalyListQuery, dismissBody, anomalyIdParam } from "./validators.js";
import * as queries from "./queries.js";
import * as commands from "./commands.js";

const READER_ROLES = ["audit_officer", "finance_admin", "finance_officer", "super_admin", "tenant_admin"];
const DISMISS_ROLES = ["audit_officer", "finance_admin", "super_admin"];

export async function anomalyRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /v1/finance/anomalies?status=open|reviewed|dismissed
   *
   * Paginated list of flagged anomalies, tenant-scoped.
   * Returns standard list envelope: { data, meta: { page, pageSize, total } }
   */
  app.get("/v1/finance/anomalies", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);

    const query = anomalyListQuery.parse(req.query);
    const result = await queries.listAnomalies(ctx.tenantId, {
      status: query.status ?? undefined,
      page: query.page,
      pageSize: query.pageSize,
    });

    return reply.send({
      data: result.data,
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total: result.total,
      },
    });
  });

  /**
   * PATCH /v1/finance/anomalies/:id/dismiss
   *
   * Dismiss an anomaly with a required reason. Only audit_officer / finance_admin can dismiss.
   * Prevents re-flagging of the same transaction.
   *
   * Requirements: 11.7
   */
  app.patch("/v1/finance/anomalies/:id/dismiss", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, DISMISS_ROLES);

    const { id } = anomalyIdParam.parse(req.params);
    const { reason } = dismissBody.parse(req.body);

    // Verify the anomaly exists and belongs to this tenant
    const existing = await queries.getAnomalyById(ctx.tenantId, id);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "anomaly not found");
    }

    if (existing.status === "dismissed") {
      throw new HttpError(409, "ALREADY_DISMISSED", "anomaly already dismissed");
    }

    const result = await commands.dismissAnomaly(ctx, id, reason);

    return reply.send({
      data: {
        id: result.id,
        status: result.status,
        dismissedBy: ctx.actorId,
        reason,
      },
    });
  });

  // Scoped error handler for anomaly routes
  app.setErrorHandler(financeErrorHandler);
}
