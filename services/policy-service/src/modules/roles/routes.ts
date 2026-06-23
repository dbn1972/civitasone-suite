import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { roleListResponseSchema } from "@civitasone/schemas/web";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createRoleBody, updateRoleBody, addPermissionBody, roleIdParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const ADMIN = ["platform_admin", "super_admin", "tenant_admin"];

export async function roleRoutes(app: FastifyInstance): Promise<void> {
  app.post("/policy/roles", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const body = createRoleBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createRole(ctx, body));
  });

  app.get("/policy/roles/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = roleIdParam.parse(req.params);
    const view = await queries.getRole(ctx.tenantId, id);
    if (!view) throw new HttpError(404, "NOT_FOUND", "role not found");
    return reply.send(view);
  });

  app.get("/policy/roles", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    sendValidated(reply, roleListResponseSchema, await queries.listRoles(ctx.tenantId));
  });

  app.patch("/policy/roles/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = roleIdParam.parse(req.params);
    const body = updateRoleBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateRole(ctx, id, body));
  });

  app.get("/policy/roles/:id/permissions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = roleIdParam.parse(req.params);
    const role = await queries.getRole(ctx.tenantId, id);
    if (!role) throw new HttpError(404, "NOT_FOUND", "role not found");
    const data = await queries.listRolePermissions(ctx.tenantId, id);
    return reply.send({ data });
  });

  app.post("/policy/roles/:id/permissions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = roleIdParam.parse(req.params);
    const body = addPermissionBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.addPermission(ctx, id, body));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
