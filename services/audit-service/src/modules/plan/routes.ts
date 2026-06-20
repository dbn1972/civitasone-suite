import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createPlanBody, createPlanItemBody, idParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const AUDIT_ROLES = ["audit_officer", "audit_admin", "super_admin"];
const READER_ROLES = [...AUDIT_ROLES, "finance_admin"];

export async function planRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/audit/plans", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, AUDIT_ROLES);
    const body = createPlanBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createPlan(ctx, body));
  });

  app.post("/v1/audit/plans/:id/items", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, AUDIT_ROLES);
    const { id } = idParam.parse(req.params);
    const body = createPlanItemBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createPlanItem(ctx, id, body));
  });

  app.patch("/v1/audit/plans/:id/start", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, AUDIT_ROLES);
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.startPlan(ctx, id));
  });

  app.get("/v1/audit/plans/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const plan = await queries.getPlan(id, ctx.tenantId);
    if (!plan) throw new HttpError(404, "NOT_FOUND", "plan not found");
    return reply.send(plan);
  });

  app.setErrorHandler(errorHandler);
}

function errorHandler(err: unknown, req: { headers: Record<string, unknown>; id: string; log: { error: (o: object, m: string) => void } }, reply: { code: (n: number) => { send: (o: object) => void } }): void {
  const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
  if (err instanceof ZodError) {
    void reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    return;
  }
  if (err instanceof HttpError) {
    void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    return;
  }
  req.log.error({ err }, "unhandled error");
  void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
}
