import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { getNotifications } from "./queries.js";

const READER_ROLES = [
  "estab_officer", "estab_admin", "estab_division_admin", "super_admin", "audit_officer",
];

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/estab/notifications", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { limit } = listQuery.parse(req.query);
    const data = await getNotifications(ctx.tenantId, limit);
    return reply.send({ data });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false,
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
