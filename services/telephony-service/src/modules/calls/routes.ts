/**
 * calls HTTP routes. zod-validated on every boundary; tenant scoping + RBAC on
 * every handler. Writes return 202-accepted (CQRS); reads mask PII unless admin.
 */
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  createCallBody,
  ringCallBody,
  answerCallBody,
  completeCallBody,
  endCallBody,
  assignCallBody,
  ivrHitBody,
  linkCallBody,
  recordingBody,
  listCallsQuery,
  idParam,
  callsListSchema,
} from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const TELEPHONY_ROLES = ["telephony_user", "telephony_supervisor", "telephony_admin", "super_admin"];
const SUPERVISOR_ROLES = ["telephony_supervisor", "telephony_admin", "super_admin"];
const ADMIN_ROLES = ["telephony_admin", "super_admin"];

function isAdmin(roles: string[]): boolean {
  return roles.some((r) => ADMIN_ROLES.includes(r));
}

export async function callRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/telephony/calls", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TELEPHONY_ROLES);
    const body = createCallBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createCall(ctx, body));
  });

  app.get("/v1/telephony/calls", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TELEPHONY_ROLES);
    const q = listCallsQuery.parse(req.query);
    sendValidated(
      reply,
      callsListSchema,
      await queries.listCalls(ctx.tenantId, q.limit, q.offset, {
        ...(q.status ? { status: q.status } : {}),
        ...(q.direction ? { direction: q.direction } : {}),
        ...(q.queueId ? { queueId: q.queueId } : {}),
        ...(q.agentId ? { agentId: q.agentId } : {}),
        ...(q.callerNumber ? { callerNumber: q.callerNumber } : {}),
      }),
    );
  });

  // Static route registered before the parametric `:id` route.
  app.get("/v1/telephony/calls/metrics", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TELEPHONY_ROLES);
    const queueId = typeof (req.query as { queueId?: string }).queueId === "string"
      ? (req.query as { queueId?: string }).queueId
      : undefined;
    return reply.send(await queries.callMetrics(ctx.tenantId, queueId));
  });

  app.get("/v1/telephony/calls/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TELEPHONY_ROLES);
    const { id } = idParam.parse(req.params);
    const call = await queries.getCall(id, ctx.tenantId, isAdmin(ctx.roles));
    if (!call) throw new HttpError(404, "NOT_FOUND", "call not found");
    return reply.send(call);
  });

  app.post("/v1/telephony/calls/:id/ring", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TELEPHONY_ROLES);
    const { id } = idParam.parse(req.params);
    const body = ringCallBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.ringCall(ctx, id, body));
  });

  app.post("/v1/telephony/calls/:id/answer", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TELEPHONY_ROLES);
    const { id } = idParam.parse(req.params);
    const body = answerCallBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.answerCall(ctx, id, body));
  });

  app.post("/v1/telephony/calls/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TELEPHONY_ROLES);
    const { id } = idParam.parse(req.params);
    const body = completeCallBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.completeCall(ctx, id, body));
  });

  app.post("/v1/telephony/calls/:id/miss", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TELEPHONY_ROLES);
    const { id } = idParam.parse(req.params);
    const body = endCallBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.missCall(ctx, id, body));
  });

  app.post("/v1/telephony/calls/:id/abandon", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TELEPHONY_ROLES);
    const { id } = idParam.parse(req.params);
    const body = endCallBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.abandonCall(ctx, id, body));
  });

  app.post("/v1/telephony/calls/:id/assign", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SUPERVISOR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = assignCallBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.assignCall(ctx, id, body));
  });

  app.post("/v1/telephony/calls/:id/ivr-hits", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TELEPHONY_ROLES);
    const { id } = idParam.parse(req.params);
    const body = ivrHitBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.recordIvrHit(ctx, id, body));
  });

  app.post("/v1/telephony/calls/:id/link", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TELEPHONY_ROLES);
    const { id } = idParam.parse(req.params);
    const body = linkCallBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.linkCall(ctx, id, body));
  });

  app.post("/v1/telephony/calls/:id/recording", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SUPERVISOR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = recordingBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.attachRecording(ctx, id, body));
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
