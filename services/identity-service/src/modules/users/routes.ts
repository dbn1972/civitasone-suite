import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { userListResponseSchema } from "@civitasone/schemas/web";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createUserBody, updateUserBody, statusBody, userIdParam, tenantIdQuery } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as sessionCommands from "../sessions/commands.js";
import * as keycloak from "../../shared/keycloak.js";

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
    if (ctx.actorId !== id) requireRole(ctx, ADMIN);
    const view = await queries.getUser(ctx.tenantId, id);
    if (!view) throw new HttpError(404, "NOT_FOUND", "user not found");
    return reply.send(view);
  });

  app.get("/identity/users", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const raw = req.query as Record<string, string | undefined>;
    const q = tenantIdQuery.parse({
      ...raw,
      tenantId: raw.tenantId ?? ctx.tenantId,
    });
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

  // Keycloak drift-reconcile: re-sync a user's realm state to identity-service.
  // Admin-gated; best-effort; returns the reconcile result (or skipped when
  // Keycloak admin creds are not configured).
  app.post("/identity/users/:id/keycloak-reconcile", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = userIdParam.parse(req.params);
    const view = await queries.getUser(ctx.tenantId, id);
    if (!view) throw new HttpError(404, "NOT_FOUND", "user not found");
    const result = await keycloak.reconcileUser(
      { id: view.id, tenantId: view.tenantId, email: view.email, name: view.name, active: view.status === "active" },
    );
    return reply.send({ userId: id, keycloak: result });
  });

  // P0 security — Revoke ALL of a user's active sessions. Admin-gated and
  // tenant-scoped: we load the user under the caller's tenant first so a
  // wrong-tenant / unknown id is a 404 and never revokes another tenant's
  // sessions. The actual bulk revoke + audit happen in the sessions consumer.
  app.post("/identity/users/:id/sessions/revoke-all", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = userIdParam.parse(req.params);
    const view = await queries.getUser(ctx.tenantId, id);
    if (!view) throw new HttpError(404, "NOT_FOUND", "user not found");
    return sendAccepted(reply, acceptedResponseSchema, await sessionCommands.revokeAllSessions(ctx, id));
  });

  // P0 security — Reset a user's password. Admin-gated and tenant-scoped. The
  // request is durably recorded via an audit event (outbox) and a best-effort
  // Keycloak UPDATE_PASSWORD action is triggered. Returns 202 Accepted. See the
  // consumer + keycloak helper for the honest semantics when Keycloak is off.
  app.post("/identity/users/:id/reset-password", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = userIdParam.parse(req.params);
    const view = await queries.getUser(ctx.tenantId, id);
    if (!view) throw new HttpError(404, "NOT_FOUND", "user not found");
    return sendAccepted(reply, acceptedResponseSchema, await commands.requestPasswordReset(ctx, id));
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
