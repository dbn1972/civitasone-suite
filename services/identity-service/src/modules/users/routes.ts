import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { userListResponseSchema } from "@civitasone/schemas/web";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createUserBody, updateUserBody, statusBody, userIdParam, tenantIdQuery, userSearchQuery, reasonBody } from "./validators.js";
import { directoryQuery } from "./directory-validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as sessionCommands from "../sessions/commands.js";
import * as keycloak from "../../shared/keycloak.js";
import { persistKeycloakUserId } from "./keycloak-link.js";
import { cache } from "../../shared/infra.js";

const ADMIN = ["platform_admin", "super_admin", "tenant_admin"];
export const PASSWORD_RESET_MAX_PER_WINDOW = 3;
export const PASSWORD_RESET_WINDOW_SECONDS = 15 * 60;

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

  // GAP-ADMIN-USERS-03: filtered, paged directory with a real total and per-status counts.
  // Registered next to the list route; a static path always wins over /identity/users/:id.
  app.get("/identity/users/search", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const raw = req.query as Record<string, string | undefined>;
    const q = userSearchQuery.parse({ ...raw, tenantId: raw.tenantId ?? ctx.tenantId });
    if (ctx.tenantId !== q.tenantId && !ctx.roles.some((r) => ["platform_admin", "super_admin"].includes(r))) {
      throw new HttpError(403, "FORBIDDEN", "cross-tenant access denied");
    }
    return reply.send(await queries.searchUsers(q.tenantId, { q: q.q, status: q.status, limit: q.limit, offset: q.offset }));
  });

  // Shared user directory (GAP-WORKFLOW-INSTANCES-DETAIL-01 /
  // GAP-PROJECTS-DETAIL-MEMBERS-01). Unlike GET /identity/users (admin-gated,
  // exposes email + status), this is available to ANY authenticated member of
  // the caller's OWN tenant and returns ONLY {id, displayName} — the minimum a
  // UI needs to show a human name instead of a raw UUID. Strictly tenant-scoped
  // (RLS GUC from the token + explicit tenantId filter): there is NO tenantId
  // query param, so a caller can only ever read names within their own tenant.
  // Static path, registered before the parametric /identity/users/:id so it is
  // never shadowed by it.
  const directoryHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    const ctx = resolveContext(req); // 401 for an unauthenticated caller; no role gate.
    const q = directoryQuery.parse(req.query);
    const rows = q.ids
      ? await queries.directoryByIds(ctx.tenantId, q.ids)
      : await queries.directoryByQuery(ctx.tenantId, q.q as string, q.limit);
    return reply.send({ data: rows });
  };
  // Same effective limit as the plugin default (100/min per tenant+IP), stated per route so it is explicit.
  const directoryRoute = { config: { rateLimit: { max: 100, timeWindow: "1 minute" } } };
  app.get("/identity/users/directory", directoryRoute, directoryHandler);
  // The web reaches this endpoint as /api/v1/identity/users/directory (shared lib/directory helpers and the pickers
  // built on them). The gateway's identity-v1 prefix forwards that verbatim to /v1/identity/users/directory, a path
  // this service never registered, so every directory lookup (officer names on the works approvals registers
  // included) 404ed in a real stack. Serve the same handler on the versioned path; /api/identity/* is not an
  // option for the web because that prefix is gateway-public and carries the strict 10/min auth limit.
  app.get("/v1/identity/users/directory", directoryRoute, directoryHandler);

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
    // FQ14: also (re)record the identity -> Keycloak id mapping, so this route
    // doubles as the per-user backfill for users created before migration 0033.
    // Recorded only when the realm user's `tid` equals this tenant; a realm
    // user without it is reported (tid_missing), never mapped.
    const keycloakUserIdLink = result.ok && result.kcUserId
      ? (result.tenantVerified ? await persistKeycloakUserId(ctx.tenantId, view.id, result.kcUserId) : "tid_missing")
      : undefined;
    return reply.send({ userId: id, keycloak: result, ...(keycloakUserIdLink ? { keycloakUserIdLink } : {}) });
  });

  // P0 security — Revoke ALL of a user's active sessions. Admin-gated and
  // tenant-scoped: we load the user under the caller's tenant first so a
  // wrong-tenant / unknown id is a 404 and never revokes another tenant's
  // sessions. The actual bulk revoke + audit happen in the sessions consumer.
  app.post("/identity/users/:id/sessions/revoke-all", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = userIdParam.parse(req.params);
    // GAP-TENANT-ADMIN-USERS-DETAIL-01: optional, audited reason (additive —
    // older callers that send no body still work).
    const { reason } = reasonBody.parse(req.body ?? {});
    const view = await queries.getUser(ctx.tenantId, id);
    if (!view) throw new HttpError(404, "NOT_FOUND", "user not found");
    return sendAccepted(reply, acceptedResponseSchema, await sessionCommands.revokeAllSessions(ctx, id, reason));
  });

  // P0 security — Reset a user's password. Admin-gated and tenant-scoped. The
  // request is durably recorded via an audit event (outbox) and a best-effort
  // Keycloak UPDATE_PASSWORD action is triggered. Returns 202 Accepted. See the
  // consumer + keycloak helper for the honest semantics when Keycloak is off.
  app.post("/identity/users/:id/reset-password", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = userIdParam.parse(req.params);
    // GAP-TENANT-ADMIN-USERS-DETAIL-01: optional, audited reason.
    const { reason } = reasonBody.parse(req.body ?? {});
    const view = await queries.getUser(ctx.tenantId, id);
    if (!view) throw new HttpError(404, "NOT_FOUND", "user not found");
    // GAP-TENANT-ADMIN-USERS-DETAIL-06: a reset sends the user an email, so an admin
    // (or a script holding an admin token) must not be able to flood one account's
    // inbox. At most PASSWORD_RESET_MAX_PER_WINDOW requests per user per window;
    // the counter is per tenant+user and expires on its own.
    const attempts = await cache.incr(cache.makeKey(ctx.tenantId, "pwreset_rate", id), PASSWORD_RESET_WINDOW_SECONDS);
    if (attempts > PASSWORD_RESET_MAX_PER_WINDOW) {
      throw new HttpError(429, "RESET_RECENTLY_REQUESTED", "a password reset was already requested for this user recently");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.requestPasswordReset(ctx, id, reason));
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
