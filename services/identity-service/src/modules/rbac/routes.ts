import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  createRoleBody, createPermissionBody, rolePermissionBody, assignRoleBody, revokeRoleBody,
  roleIdParam, roleUserParam, rolePermParam, userIdParam, listQuery,
} from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const ADMIN = ["platform_admin", "super_admin", "tenant_admin"];

export async function rbacRoutes(app: FastifyInstance): Promise<void> {
  // ── roles ────────────────────────────────────────────────────────────
  app.post("/identity/rbac/roles", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const body = createRoleBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createRole(ctx, body));
  });

  app.get("/identity/rbac/roles", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const q = listQuery.parse(req.query);
    return reply.send(await queries.listRoles(ctx.tenantId, q.limit, q.offset));
  });

  app.get("/identity/rbac/roles/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = roleIdParam.parse(req.params);
    const role = await queries.getRole(ctx.tenantId, id);
    if (!role) throw new HttpError(404, "NOT_FOUND", "role not found");
    const permissions = await queries.rolePermissionKeys(ctx.tenantId, id);
    return reply.send({ ...role, permissions });
  });

  // ── permissions ──────────────────────────────────────────────────────
  app.post("/identity/rbac/permissions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const body = createPermissionBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createPermission(ctx, body));
  });

  app.get("/identity/rbac/permissions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const q = listQuery.parse(req.query);
    return reply.send(await queries.listPermissions(ctx.tenantId, q.limit, q.offset));
  });

  // ── role <-> permission ──────────────────────────────────────────────
  app.post("/identity/rbac/roles/:id/permissions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = roleIdParam.parse(req.params);
    const body = rolePermissionBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.grantPermission(ctx, id, body.permissionId));
  });

  app.delete("/identity/rbac/roles/:id/permissions/:permissionId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id, permissionId } = rolePermParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.revokePermission(ctx, id, permissionId));
  });

  // ── role <-> user ────────────────────────────────────────────────────
  app.post("/identity/rbac/roles/:id/assignments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = roleIdParam.parse(req.params);
    const body = assignRoleBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.assignRole(ctx, id, body.userId, body.reason));
  });

  app.delete("/identity/rbac/roles/:id/assignments/:userId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id, userId } = roleUserParam.parse(req.params);
    const body = revokeRoleBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.revokeRole(ctx, id, userId, body.reason));
  });

  // ── effective access for a user ───────────────────────────────────────
  app.get("/identity/rbac/users/:userId/effective", async (req, reply) => {
    const ctx = resolveContext(req);
    // A user may read their own effective access; admins may read anyone's.
    const { userId } = userIdParam.parse(req.params);
    if (ctx.actorId !== userId) requireRole(ctx, ADMIN);
    return reply.send(await queries.effectiveAccess(ctx.tenantId, userId));
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
