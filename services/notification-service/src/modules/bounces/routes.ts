/**
 * INT-12 — bounce ingestion + suppression list management.
 *
 * POST   /v1/notification/bounces                    — record a bounce (202)
 * GET    /v1/notification/suppressions               — list suppression entries
 * GET    /v1/notification/suppressions/check         — is a recipient suppressed?
 * DELETE /v1/notification/suppressions/:id           — release a suppression (202)
 *
 * Recipient values are PII: they are accepted in request bodies/queries, stored
 * encrypted, and are never echoed back in a response or written to a log.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const WRITE_ROLES = ["notification_admin", "super_admin", "tenant_admin", "platform_admin"];
const READ_ROLES = [...WRITE_ROLES, "audit_officer"];

const recordBounceBody = z.object({
  recipient: z.string().min(3).max(254),
  deliveryId: z.string().uuid().optional(),
  channel: z.enum(["email", "sms", "whatsapp", "push"]).optional(),
  smtpCode: z.string().min(1).max(32).optional(),
  reason: z.string().min(1).max(2000).optional(),
  occurredAt: z.string().datetime().optional(),
});

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200),
  offset: z.coerce.number().int().min(0).default(0),
  activeOnly: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

const checkQuery = z.object({ recipient: z.string().min(3).max(254) });
const idParam = z.object({ id: z.string().uuid() });

export async function bounceRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/notification/bounces", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = recordBounceBody.parse(req.body);
    // 422: a bounce with neither an SMTP code nor a reason cannot be classified,
    // and an unclassifiable bounce must never reach the suppression list.
    if (body.smtpCode === undefined && body.reason === undefined) {
      throw new HttpError(422, "UNCLASSIFIABLE_BOUNCE", "at least one of smtpCode or reason is required");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.recordBounce(ctx, body));
  });

  app.get("/v1/notification/suppressions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.listSuppressions(ctx.tenantId, q.limit, q.offset, q.activeOnly);
    return reply.send({
      data: rows,
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total },
    });
  });

  app.get("/v1/notification/suppressions/check", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = checkQuery.parse(req.query);
    const found = await repo.checkSuppression(ctx.tenantId, q.recipient);
    return reply.send({ data: { suppressed: found !== null, entry: found } });
  });

  app.delete("/v1/notification/suppressions/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    return sendAccepted(reply, acceptedResponseSchema, await commands.releaseSuppression(ctx, id));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
