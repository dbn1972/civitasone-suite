import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import { scopedRead } from "../../shared/db.js";
import { asc, eq } from "drizzle-orm";
import { COMMANDS } from "../../topics.js";
import { publishConfig } from "./commands.js";
import { categories } from "./categories-schema.js";

const CONFIG_ROLES = ["helpdesk_admin", "super_admin"];
const READ_ROLES = ["helpdesk_user", "helpdesk_admin", "super_admin"];

const createCategoryBody = z.object({
  name: z.string().min(1).max(128),
  parentId: z.string().uuid().nullable().optional(),
  ordinal: z.number().int().min(0).optional(),
  enabled: z.boolean().optional(),
});

const updateCategoryBody = z.object({
  name: z.string().min(1).max(128).optional(),
  parentId: z.string().uuid().nullable().optional(),
  ordinal: z.number().int().min(0).optional(),
  enabled: z.boolean().optional(),
});

const idParam = z.object({ id: z.string().uuid() });

export async function categoriesRoutes(app: FastifyInstance): Promise<void> {
  /** CFG-02: List categories (flat with parentId). */
  app.get("/v1/helpdesk/config/categories", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);

    const cacheKey = cache.makeKey(ctx.tenantId, "categories", "list");
    const data = await cache.getOrLoad<{ data: unknown[] }>(cacheKey, async () => {
      const rows = await scopedRead((tx) =>
        tx.select().from(categories).where(eq(categories.tenantId, ctx.tenantId)).orderBy(asc(categories.ordinal), asc(categories.name)),
      );
      return { data: rows };
    });

    return reply.send(data);
  });

  /** CFG-02: Create a category. */
  app.post("/v1/helpdesk/config/categories", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CONFIG_ROLES);
    const body = createCategoryBody.parse(req.body);

    const id = randomUUID();
    await publishConfig(ctx, COMMANDS.configCategoryCreate, {
      id,
      name: body.name,
      parentId: body.parentId ?? null,
      ordinal: body.ordinal ?? 0,
      enabled: body.enabled ?? true,
    });
    await cache.invalidateResource(ctx.tenantId, "categories");

    return reply.code(201).send({
      data: {
        id,
        tenantId: ctx.tenantId,
        name: body.name,
        parentId: body.parentId ?? null,
        ordinal: body.ordinal ?? 0,
        enabled: body.enabled ?? true,
      },
    });
  });

  /** CFG-02: Update a category. */
  app.patch("/v1/helpdesk/config/categories/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CONFIG_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateCategoryBody.parse(req.body);

    if (Object.keys(body).length === 0) {
      throw new HttpError(400, "EMPTY_BODY", "at least one field required");
    }

    await publishConfig(ctx, COMMANDS.configCategoryUpdate, { id, ...body });
    await cache.invalidateResource(ctx.tenantId, "categories");

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
