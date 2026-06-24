import { sendAccepted, sendValidated } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { BreakglassSummaryListSchema } from "@civitasone/schemas/web";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireSuperAdmin, HttpError } from "../../shared/context.js";
import { breakGlassBody, closeParam, breakGlassListQuery } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

export async function supportRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/admin/breakglass", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    // P1-3: platform-wide review; an optional tenantId query param targets a
    // specific tenant instead of being pinned to the caller's own ctx.tenantId.
    const q = breakGlassListQuery.parse(req.query);
    const rows = await repo.listBreakGlass(q.limit, q.tenantId);
    sendValidated(reply, BreakglassSummaryListSchema, rows.map((row) => ({
      id: row.id,
      actor: row.actorId,
      // P2-2: no email is captured for break-glass actors (only actor_id, a uuid).
      // Emit an empty string rather than misrepresenting the uuid as an email.
      actorEmail: "",
      reason: row.reason,
      resourceAccessed: row.ticketId,
      startedAt: new Date(row.openedAt as unknown as string).toISOString(),
      endedAt: row.closedAt?.toISOString(),
      status: (row.closedAt ? "ended" : row.expiresAt < new Date() ? "auto_expired" : "active") as "active" | "ended" | "auto_expired",
    })));
  });

  app.post("/v1/admin/support/break-glass", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const body = breakGlassBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.openBreakGlass(ctx, body.tenantId, body.ticketId, body.reason));
  });

  app.patch("/v1/admin/support/break-glass/:id/close", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const { id } = closeParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.closeBreakGlass(ctx, id));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
