import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { sendAccepted, sendValidated } from "@civitasone/schemas/validate";
import { acceptedResponseSchema, listQuerySchema } from "@civitasone/schemas/common";
import { SessionSummaryListSchema } from "@civitasone/schemas/web";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createSessionBody, sessionIdParam, sessionRevokeBody, sessionRevealIpBody } from "./validators.js";
import { shortUserAgent, maskSessionIp } from "./domain.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const SESSION_ADMIN = ["platform_admin", "super_admin", "tenant_admin"];
// Owner decision #21: only the security admin may reveal a session's clear IP.
const SESSION_IP_REVEAL = ["security_admin"];
// The security admin must be able to OPEN a session to reach the reveal action, so it
// may read the (masked) list and detail. It still cannot create or revoke sessions.
const SESSION_READ = [...SESSION_ADMIN, ...SESSION_IP_REVEAL];

export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  app.post("/identity/sessions", async (req, reply) => {
    const ctx = resolveContext(req);
    const body = createSessionBody.parse(req.body);
    if (ctx.tenantId !== body.tenantId) {
      throw new HttpError(403, "FORBIDDEN", "tenant mismatch");
    }
    const isSelfService = ctx.actorId === body.userId;
    if (!isSelfService) requireRole(ctx, SESSION_ADMIN);

    // SEC-015: a self-created session row must be keyed by the caller's OWN
    // verified Keycloak session (sid) -- that correlation is the entire
    // reason this row exists (SEC-006's denylist revokes by sid). Derived
    // from ctx (populated by authPlugin from the independently-verified
    // bearer token), never trusted from the request body. An admin creating
    // a session record for someone ELSE has no way to know that other
    // user's sid, so this requirement is scoped to the self-service path
    // only; that path is unchanged (random id) since nothing real exercises
    // it today (see SEC-015's gap-report row).
    if (isSelfService) {
      if (!ctx.sessionId || !sessionIdParam.shape.id.safeParse(ctx.sessionId).success) {
        throw new HttpError(400, "MISSING_SESSION_ID", "access token has no sid claim");
      }
      return sendAccepted(reply, acceptedResponseSchema, await commands.createSession(ctx, body, ctx.sessionId));
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.createSession(ctx, body));
  });

  app.delete("/identity/sessions/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = sessionIdParam.parse(req.params);
    // GAP-TENANT-ADMIN-USERS-DETAIL-02: optional, audited reason (additive;
    // the self-service sign-out path sends no body and still works).
    const { reason } = sessionRevokeBody.parse(req.body ?? {});
    // P1-1: authorize the revoke. Load the session (tenant-scoped) and require
    // the caller to be the session owner OR a session admin. A miss (wrong
    // tenant or unknown id) is a 404, not an implicit revoke.
    const view = await queries.getSession(ctx.tenantId, id);
    if (!view) throw new HttpError(404, "NOT_FOUND", "session not found");
    if (view.userId !== ctx.actorId) requireRole(ctx, SESSION_ADMIN);
    return sendAccepted(reply, acceptedResponseSchema, await commands.revokeSession(ctx, id, reason));
  });

  app.get("/identity/sessions/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = sessionIdParam.parse(req.params);
    const view = await queries.getSession(ctx.tenantId, id);
    if (!view) throw new HttpError(404, "NOT_FOUND", "session not found");
    if (view.userId !== ctx.actorId) requireRole(ctx, SESSION_READ);
    // Owner decision #21: an admin looking at SOMEONE ELSE's session gets a masked
    // IP and a "browser on OS" user agent; the owner sees their own session as-is.
    if (view.userId === ctx.actorId) return reply.send(view);
    return reply.send({ ...view, ip: maskSessionIp(view.ip), userAgent: shortUserAgent(view.userAgent) });
  });

  // Owner decision #21: audited reveal of the clear source IP (security admin,
  // reason required, caller's own tenant only). The audit command is published
  // before the value is returned, so a failed audit means no reveal.
  app.post("/identity/sessions/:id/reveal-ip", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SESSION_IP_REVEAL);
    const { id } = sessionIdParam.parse(req.params);
    const parsed = sessionRevealIpBody.safeParse(req.body ?? {});
    if (!parsed.success) throw new HttpError(400, "VALIDATION_FAILED", "a reason of at least 10 characters is required to reveal an IP address");
    const { reason } = parsed.data;
    const view = await queries.getSession(ctx.tenantId, id);
    if (!view) throw new HttpError(404, "NOT_FOUND", "session not found");
    await commands.recordSessionIpReveal(ctx, id, reason);
    void reply.header("cache-control", "no-store");
    return reply.send({ id, ipAddress: view.ip });
  });

  app.get("/identity/sessions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SESSION_READ);
    const q = listQuerySchema.parse(req.query);
    const rows = await queries.listSessions(ctx.tenantId, q.limit);
    sendValidated(reply, SessionSummaryListSchema, (rows ?? []).map((s) => ({
      id: s.id,
      userId: s.userId,
      userEmail: s.userEmail,
      userName: s.userName ?? undefined,
      ipAddress: maskSessionIp(s.ip),
      userAgent: shortUserAgent(s.userAgent) ?? undefined,
      createdAt: s.startedAt,
      lastActiveAt: s.lastActiveAt,
      expiresAt: s.expiresAt,
      mfaVerified: s.mfaMethod !== null,
      status: s.status,
    })));
  });
}
