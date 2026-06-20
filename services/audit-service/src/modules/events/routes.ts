import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { listQuerySchema } from "@civitasone/schemas/common";
import { auditEventsListSchema } from "@civitasone/schemas/web";
import { sendValidated } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as queries from "./queries.js";

export async function eventRoutes(app: FastifyInstance): Promise<void> {
  app.get("/audit/events", async (req, reply) => {
    const ctx = resolveContext(req);
    const q = listQuerySchema.extend({
      tenantId: z.string().uuid().optional(),
      from:     z.string().datetime().optional(),
      to:       z.string().datetime().optional(),
      type:     z.string().optional(),
    }).parse(req.query);
    const tenantId = q.tenantId ?? ctx.tenantId;
    const from = q.from ? new Date(q.from) : new Date(Date.now() - 7 * 86400 * 1000);
    const to   = q.to   ? new Date(q.to)   : new Date();
    sendValidated(reply, auditEventsListSchema, await queries.listEvents(tenantId, from, to, q.type, q.limit, q.offset));
  });

  app.get("/audit/events/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const view = await queries.getEvent(ctx.tenantId, id);
    if (!view) throw new HttpError(404, "NOT_FOUND", "event not found");
    return reply.send(view);
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
