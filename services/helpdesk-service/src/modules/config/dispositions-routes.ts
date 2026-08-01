import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";

const CONFIG_ROLES = ["helpdesk_admin", "super_admin"];
const READ_ROLES = ["helpdesk_user", "helpdesk_admin", "super_admin"];

const createDispositionBody = z.object({
  label: z.string().min(1).max(128),
  category: z.string().max(64).optional(),
  enabled: z.boolean().optional(),
});

export async function dispositionsRoutes(app: FastifyInstance): Promise<void> {
  /** CFG-05: List dispositions. */
  app.get("/v1/helpdesk/config/dispositions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);

    const cacheKey = cache.makeKey(ctx.tenantId, "dispositions", "list");
    const data = await cache.getOrLoad<{ data: unknown[] }>(cacheKey, async () => {
      return { data: [] };
    });

    return reply.send(data);
  });

  /** CFG-05: Create a disposition. */
  app.post("/v1/helpdesk/config/dispositions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CONFIG_ROLES);
    const body = createDispositionBody.parse(req.body);

    const id = randomUUID();
    await cache.invalidateResource(ctx.tenantId, "dispositions");

    return reply.code(201).send({
      data: {
        id,
        tenantId: ctx.tenantId,
        label: body.label,
        category: body.category ?? null,
        enabled: body.enabled ?? true,
      },
    });
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
