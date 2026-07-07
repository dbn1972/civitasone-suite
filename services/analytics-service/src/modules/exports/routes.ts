/**
 * exports/routes.ts — HTTP routes for analytics export jobs.
 *
 * POST /v1/analytics/exports → 202 (accepted, command queued)
 * GET  /v1/analytics/exports/:id → 302 (completed) | 409 (in-progress/failed)
 *
 * CQRS: POST validates source query then publishes a command.
 * Consumer writes to DB (no direct DB write from routes).
 *
 * Role-gated: analytics_viewer, analytics_admin, tenant_admin, super_admin
 */
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { registerErrorHandler } from "../../shared/errors.js";
import { createExportBodySchema, exportIdParam } from "./validators.js";
import { createExport } from "./commands.js";
import { getExportJob } from "./queries.js";
import { getQueryRun } from "../queries/queries.js";
import type { ExportFormat } from "./domain.js";

const EXPORT_ROLES = ["analytics_viewer", "analytics_admin", "tenant_admin", "super_admin"];

export async function exportRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /v1/analytics/exports
   * Validates source query exists and is completed, then publishes export command.
   * Returns 202 with { data: { id, status: "pending" } }
   * Returns 422 if source query unavailable (not found or not completed)
   */
  app.post("/v1/analytics/exports", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, EXPORT_ROLES);

    const body = createExportBodySchema.parse(req.body);

    // Validate source query run exists and is completed
    const queryRun = await getQueryRun(ctx.tenantId, body.queryRunId);
    if (!queryRun || queryRun.status !== "completed") {
      throw new HttpError(422, "SOURCE_QUERY_UNAVAILABLE", "source query unavailable");
    }

    // Publish command to queue (CQRS — no direct DB write)
    const accepted = await createExport(ctx, {
      queryRunId: body.queryRunId,
      format: body.format as ExportFormat,
    });

    return reply.code(202).send({
      data: { id: accepted.id, status: "pending" },
    });
  });

  /**
   * GET /v1/analytics/exports/:id
   * If status = "completed" → 302 redirect to presigned URL.
   * If status = "processing" or "pending" → 409 { error: { code: "EXPORT_IN_PROGRESS" } }
   * If status = "failed" → 409 { error: { code: "EXPORT_FAILED", message } }
   * If not found → 404
   */
  app.get("/v1/analytics/exports/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, EXPORT_ROLES);

    const { id } = exportIdParam.parse(req.params);
    const exportJob = await getExportJob(ctx.tenantId, id);

    if (!exportJob) {
      throw new HttpError(404, "NOT_FOUND", "export not found");
    }

    if (exportJob.status === "completed" && exportJob.downloadUrl) {
      return reply.redirect(exportJob.downloadUrl);
    }

    if (exportJob.status === "failed") {
      return reply.code(409).send({
        error: {
          code: "EXPORT_FAILED",
          message: exportJob.error ?? "export generation failed",
        },
      });
    }

    // pending or processing
    return reply.code(409).send({
      error: {
        code: "EXPORT_IN_PROGRESS",
      },
    });
  });

  registerErrorHandler(app);
}
