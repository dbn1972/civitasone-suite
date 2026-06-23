import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createDealBody, updateDealStageBody, idParam, dealsListSchema } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin"];

export async function dealRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/crm/deals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const body = createDealBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createDeal(ctx, body));
  });

  app.get("/v1/crm/deals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, dealsListSchema, await queries.listDeals(ctx.tenantId, q.limit, q.offset));
  });

  app.get("/v1/crm/deals/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const deal = await queries.getDeal(id, ctx.tenantId);
    if (!deal) throw new HttpError(404, "NOT_FOUND", "deal not found");
    return reply.send(deal);
  });

  app.patch("/v1/crm/deals/:id/stage", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateDealStageBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateDealStage(ctx, id, body));
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
