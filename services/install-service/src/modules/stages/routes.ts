import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createStageBody, idParam, stagesListSchema } from "./validators.js";
import { InstallStepSummaryListSchema } from "@civitasone/schemas/web";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
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

  /** PATCH /v1/install/steps/:id/:verb — trigger step lifecycle (run, skip, retry) */
  app.patch("/v1/install/steps/:id/:verb", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const params = idParam.extend({ verb: z.enum(["run", "skip", "retry"]) }).parse(req.params);
    const { id, verb } = params;

    const topicMap = {
      run: COMMANDS.stepStart,
      retry: COMMANDS.stepStart,
      skip: COMMANDS.stepSkip,
    } as const;
    const topic = topicMap[verb];

    await queue.publish(topic, {
      messageId: id,
      type: topic,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId, verb },
    });
    sendAccepted(reply, acceptedResponseSchema, { id, status: "accepted", correlationId: ctx.correlationId });
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
