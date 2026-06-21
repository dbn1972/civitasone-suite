import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createStageBody, idParam, stagesListSchema } from "./validators.js";
import { InstallStepSummaryListSchema } from "@civitasone/schemas/web";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const ROLES = ["install_user","install_admin","super_admin"];

export async function stagesRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/install/stages", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = createStageBody.parse(req.body);
    sendAccepted(reply, acceptedResponseSchema, await commands.createStage(ctx, body));
  });

  app.get("/v1/install/stages", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, stagesListSchema, await queries.listStages(ctx.tenantId, q.limit, q.offset));
  });

  app.get("/v1/install/steps", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    const result = await queries.listStages(ctx.tenantId, q.limit, q.offset);
    sendValidated(reply, InstallStepSummaryListSchema, result.data.map((stage) => ({
      id: stage.id,
      stepNo: stage.stepNumber,
      title: stage.name,
      description: stage.description ?? undefined,
      status: (stage.status === "completed" ? "completed" : stage.status === "skipped" ? "skipped" : stage.status === "in_progress" ? "in_progress" : "pending") as "pending" | "in_progress" | "completed" | "skipped",
      completedAt: undefined,
    })));
  });

  app.get("/v1/install/stages/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const row = await queries.getStage(id, ctx.tenantId);
    if (!row) throw new HttpError(404, "NOT_FOUND", "stage not found");
    return reply.send(row);
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
