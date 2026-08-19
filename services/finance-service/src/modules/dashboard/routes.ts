import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { FinanceDashboardSchema } from "@civitasone/schemas/web";
import { sendValidated } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as queries from "./queries.js";

const ROLES = ["finance_officer", "finance_admin", "super_admin", "budget_officer"];

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/finance/dashboard", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    sendValidated(reply, FinanceDashboardSchema, await queries.getDashboard(ctx.tenantId));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false,
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