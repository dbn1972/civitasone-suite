/**
 * scheduled HTTP routes — CRUD for scheduled_reports.
 * POST   /v1/reports/scheduled         → 202 (create)
 * GET    /v1/reports/scheduled          → 200 (list)
 * GET    /v1/reports/scheduled/:id      → 200 (get)
 * PATCH  /v1/reports/scheduled/:id      → 202 (update, optimistic locking)
 * DELETE /v1/reports/scheduled/:id      → 202 (disable/soft-delete)
 * POST   /v1/reports/scheduled/:id/run  → 202 (trigger manual run)
 */
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { listQuerySchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createScheduledReportBody, updateScheduledReportBody, idParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const REPORT_ROLES = ["report_viewer", "report_admin", "finance_admin", "super_admin", "admin", "tenant_admin"];

export async function scheduledRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/reports/scheduled", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REPORT_ROLES);
    const body = createScheduledReportBody.parse(req.body);
    const result = await commands.createScheduledReport(ctx, body);
    return reply.code(202).send({ data: result });
  });

  app.get("/v1/reports/scheduled", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REPORT_ROLES);
    const q = listQuerySchema.parse(req.query);
    const result = await queries.listScheduledReports(ctx.tenantId, q.limit, q.offset);
    return reply.send({
      data: result.data,
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total: result.data.length },
    });
  });

  app.get("/v1/reports/scheduled/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REPORT_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await queries.getScheduledReport(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "scheduled report not found");
    return reply.send({ data: row });
  });

  app.patch("/v1/reports/scheduled/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REPORT_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateScheduledReportBody.parse(req.body);
    const result = await commands.updateScheduledReport(ctx, id, body);
    return reply.code(202).send({ data: result });
  });

  app.delete("/v1/reports/scheduled/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REPORT_ROLES);
    const { id } = idParam.parse(req.params);
    const result = await commands.disableScheduledReport(ctx, id);
    return reply.code(202).send({ data: result });
  });

  app.post("/v1/reports/scheduled/:id/run", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, REPORT_ROLES);
    const { id } = idParam.parse(req.params);
    const result = await commands.runScheduledReport(ctx, id);
    return reply.code(202).send({ data: result });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED",
        message: "invalid request",
        correlationId,
        retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
