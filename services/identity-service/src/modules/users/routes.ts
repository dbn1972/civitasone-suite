import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { userListResponseSchema } from "@civitasone/schemas/web";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createUserBody, updateUserBody, statusBody, userIdParam, tenantIdQuery } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const ADMIN = ["platform_admin", "super_admin", "tenant_admin"];

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.post("/identity/users", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const body = createUserBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createUser(ctx, body));
  });

  app.get("/identity/users/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = userIdParam.parse(req.params);
    const view = await queries.getUser(ctx.tenantId, id);
    if (!view) throw new HttpError(404, "NOT_FOUND", "user not found");
    return reply.send(view);
  });

  app.get("/identity/users", async (req, reply) => {
    const ctx = resolveContext(req);
    const q = tenantIdQuery.parse(req.query);
    if (ctx.tenantId !== q.tenantId && !ctx.roles.some((r) => ["platform_admin", "super_admin"].includes(r))) {
      throw new HttpError(403, "FORBIDDEN", "cross-tenant access denied");
    }
    sendValidated(reply, userListResponseSchema, await queries.listUsers(q.tenantId, q.limit, q.offset));
  });

  app.patch("/identity/users/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = userIdParam.parse(req.params);
    const body = updateUserBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateUser(ctx, id, body));
  });

  app.patch("/identity/users/:id/status", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = userIdParam.parse(req.params);
    const body = statusBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.changeUserStatus(ctx, id, body));
  });

  app.delete("/identity/users/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = userIdParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.changeUserStatus(ctx, id, { status: "deactivated" }));
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
