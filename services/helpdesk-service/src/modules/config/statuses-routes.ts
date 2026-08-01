import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";

const CONFIG_ROLES = ["helpdesk_admin", "super_admin"];
const READ_ROLES = ["helpdesk_user", "helpdesk_admin", "super_admin"];

const createStatusBody = z.object({
  name: z.string().min(1).max(64),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "must be hex color e.g. #FF5500"),
  canonicalState: z.enum(["open", "pending", "resolved", "closed"]),
  ordinal: z.number().int().min(0).optional(),
});

const updateStatusBody = z.object({
  name: z.string().min(1).max(64).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "must be hex color e.g. #FF5500").optional(),
  canonicalState: z.enum(["open", "pending", "resolved", "closed"]).optional(),
  ordinal: z.number().int().min(0).optional(),
});

const idParam = z.object({ id: z.string().uuid() });

export async function statusesRoutes(app: FastifyInstance): Promise<void> {
  /** CFG-04: List status configs. */
  app.get("/v1/helpdesk/config/statuses", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);

    const cacheKey = cache.makeKey(ctx.tenantId, "status_config", "list");
    const data = await cache.getOrLoad<{ data: unknown[] }>(cacheKey, async () => {
      return { data: [] };
    });

    return reply.send(data);
  });

  /** CFG-04: Create a status config. */
  app.post("/v1/helpdesk/config/statuses", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CONFIG_ROLES);
    const body = createStatusBody.parse(req.body);

    const id = randomUUID();
    await cache.invalidateResource(ctx.tenantId, "status_config");

    return reply.code(201).send({
      data: {
        id,
        tenantId: ctx.tenantId,
        name: body.name,
        color: body.color,
        canonicalState: body.canonicalState,
        ordinal: body.ordinal ?? 0,
      },
    });
  });

  /** CFG-04: Update a status config. */
  app.patch("/v1/helpdesk/config/statuses/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CONFIG_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateStatusBody.parse(req.body);

    if (Object.keys(body).length === 0) {
      throw new HttpError(400, "EMPTY_BODY", "at least one field required");
    }

    await cache.invalidateResource(ctx.tenantId, "status_config");

    return reply.send({
      data: { id, ...body, updated: true },
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
