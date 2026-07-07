/**
 * transcription routes — GET transcript for a call.
 *
 * GET /v1/telephony/calls/:callId/transcript — return transcript text or 404
 *
 * Returns 503 when TRANSCRIPTION_ENABLED is not 'true' (fail-closed).
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { isEnabled } from "./adapter.js";

const TELEPHONY_ROLES = ["telephony_user", "telephony_supervisor", "telephony_admin", "super_admin"];

const callIdParam = z.object({ callId: z.string().uuid() });

export async function transcriptionRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Get the transcript for a call.
   * Returns 503 if transcription feature is disabled.
   * Returns 404 if no transcript exists for the call.
   */
  app.get("/v1/telephony/calls/:callId/transcript", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TELEPHONY_ROLES);

    // Fail-closed: if transcription is disabled, return 503.
    if (!isEnabled()) {
      throw new HttpError(503, "TRANSCRIPTION_DISABLED", "Transcription feature is not enabled");
    }

    const { callId } = callIdParam.parse(req.params);
    const transcript = await repo.findByCallId(ctx.tenantId, callId);

    if (!transcript) {
      throw new HttpError(404, "NOT_FOUND", "No transcript found for this call");
    }

    return reply.send({ data: transcript });
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
