import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireSuperAdmin, requireRole, HttpError } from "../../shared/context.js";
import { createPlanBody, idParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import { getTenantPlansOverview } from "./tenant-overview.js";

const OVERVIEW_READERS = ["billing_admin", "tenant_admin", "super_admin", "platform_admin"];

export async function plansRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/billing/plans", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const body = createPlanBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createPlan(ctx, body));
  });

  app.get("/v1/billing/plans", { config: { public: true } }, async (_req, reply) => {
    return reply.send(await queries.listPlans());
  });

  // F9: the tenant-admin Plans page read. The CALLER's own tenant only (ctx.tenantId, never a
  // body/query id). Registered before /plans/:id is irrelevant (different path), kept adjacent for clarity.
  app.get("/v1/billing/tenant-plans", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OVERVIEW_READERS);
    return reply.send(await getTenantPlansOverview(ctx.tenantId, req.headers.authorization));
  });

  app.get("/v1/billing/plans/:id", { config: { public: true } }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const plan = await queries.getPlan(id);
    if (!plan) throw new HttpError(404, "NOT_FOUND", "plan not found");
    return reply.send(plan);
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
