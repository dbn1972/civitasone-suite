import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { sendAccepted, sendValidated } from "@civitasone/schemas/validate";
import { acceptedResponseSchema, listQuerySchema } from "@civitasone/schemas/common";
import { SessionSummaryListSchema } from "@civitasone/schemas/web";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createSessionBody, sessionIdParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const SESSION_ADMIN = ["platform_admin", "super_admin", "tenant_admin"];

export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  app.post("/identity/sessions", async (req, reply) => {
    const ctx = resolveContext(req);
    const body = createSessionBody.parse(req.body);
    if (ctx.tenantId !== body.tenantId) {
      throw new HttpError(403, "FORBIDDEN", "tenant mismatch");
    }
    if (ctx.actorId !== body.userId) requireRole(ctx, SESSION_ADMIN);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createSession(ctx, body));
  });

  app.delete("/identity/sessions/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = sessionIdParam.parse(req.params);
    // P1-1: authorize the revoke. Load the session (tenant-scoped) and require
    // the caller to be the session owner OR a session admin. A miss (wrong
    // tenant or unknown id) is a 404, not an implicit revoke.
    const view = await queries.getSession(ctx.tenantId, id);
    if (!view) throw new HttpError(404, "NOT_FOUND", "session not found");
    if (view.userId !== ctx.actorId) requireRole(ctx, SESSION_ADMIN);
    return sendAccepted(reply, acceptedResponseSchema, await commands.revokeSession(ctx, id));
  });

  app.get("/identity/sessions/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = sessionIdParam.parse(req.params);
    const view = await queries.getSession(ctx.tenantId, id);
    if (!view) throw new HttpError(404, "NOT_FOUND", "session not found");
    if (view.userId !== ctx.actorId) requireRole(ctx, SESSION_ADMIN);
    return reply.send(view);
  });

  app.get("/identity/sessions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SESSION_ADMIN);
    const q = listQuerySchema.parse(req.query);
    const rows = await queries.listSessions(ctx.tenantId, q.limit);
    sendValidated(reply, SessionSummaryListSchema, (rows ?? []).map((s) => ({
      id: s.id,
      userId: s.userId,
      userEmail: s.userEmail,
      userName: s.userName ?? undefined,
      ipAddress: s.ip,
      userAgent: s.userAgent ?? undefined,
      createdAt: s.startedAt,
      lastActiveAt: s.lastActiveAt,
      expiresAt: s.expiresAt,
      mfaVerified: s.mfaMethod !== null,
      status: s.status,
    })));
  });
}
