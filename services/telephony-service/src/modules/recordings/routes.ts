/**
 * recordings routes — GET recordings for a call.
 *
 * GET /v1/telephony/calls/:id/recordings — list all recordings for a call
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";

const TELEPHONY_ROLES = ["telephony_user", "telephony_supervisor", "telephony_admin", "super_admin"];

const idParam = z.object({ id: z.string().uuid() });

export async function recordingRoutes(app: FastifyInstance): Promise<void> {
  /**
   * List all recordings for a call.
   */
  app.get("/v1/telephony/calls/:id/recordings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TELEPHONY_ROLES);
    const { id: callId } = idParam.parse(req.params);
    const recs = await repo.listByCall(ctx.tenantId, callId);
    return reply.send({ data: recs, meta: { total: recs.length } });
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
