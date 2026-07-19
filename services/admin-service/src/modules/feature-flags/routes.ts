/**
 * Feature Flags module HTTP routes (Fastify plugin).
 * CRUD for feature flags + kill switch endpoint.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as commands from "./commands.js";
import { featureFlags } from "./schema.js";
import { scopedRead } from "../../shared/db.js";
import { eq } from "drizzle-orm";

const ADMIN_ROLES = ["platform_admin", "super_admin"];
const RESOURCE = "feature_flag";

const createBody = z.object({
  key: z.string().min(1).max(128).regex(/^[a-z0-9_-]+$/),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).default(""),
  enabled: z.boolean().default(false),
  rolloutPercent: z.number().int().min(0).max(100).default(0),
  targetSegments: z.array(z.string().min(1).max(100)).default([]),
});

const updateBody = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  enabled: z.boolean().optional(),
  rolloutPercent: z.number().int().min(0).max(100).optional(),
  targetSegments: z.array(z.string().min(1).max(100)).optional(),
});

const idParam = z.object({ id: z.string().uuid() });

// See custom-domains/routes.ts safeParse for why Input is widened to `any`
// instead of using z.ZodSchema<T> (Input=T): schemas with `.default(...)`
// fields need T inferred from the parsed *output*, not the optional *input*.
function safeParse<T>(schema: z.ZodType<T, z.ZodTypeDef, any>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const msg = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new HttpError(400, "VALIDATION_FAILED", msg);
  }
  return result.data;
}

export async function featureFlagRoutes(app: FastifyInstance): Promise<void> {
  // LIST all flags for tenant
  app.get("/v1/admin/feature-flags/manage", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const rows = await cache.getOrLoad(
      cache.makeKey(ctx.tenantId, RESOURCE, "list"),
      async () => scopedRead((tx) => tx.select().from(featureFlags).where(eq(featureFlags.tenantId, ctx.tenantId))),
    );
    return reply.send({ data: rows });
  });

  // CREATE flag
  app.post("/v1/admin/feature-flags/manage", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = safeParse(createBody, req.body);
    const result = await commands.flagCreate(ctx, body);
    return reply.code(202).send(result);
  });

  // UPDATE flag
  app.put("/v1/admin/feature-flags/manage/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = safeParse(idParam, req.params);
    const body = safeParse(updateBody, req.body);
    if (Object.keys(body).length === 0) {
      throw new HttpError(400, "EMPTY_BODY", "at least one field must be provided");
    }
    // exactOptionalPropertyTypes: strip keys whose value is undefined so the
    // payload only ever carries `key: string` (never `key: string | undefined`)
    // for the optional fields FlagUpdatePayload declares.
    const patch = Object.fromEntries(
      Object.entries(body).filter(([, v]) => v !== undefined),
    ) as commands.FlagUpdatePayload;
    const result = await commands.flagUpdate(ctx, id, patch);
    return reply.code(202).send(result);
  });

  // DELETE flag
  app.delete("/v1/admin/feature-flags/manage/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = safeParse(idParam, req.params);
    const result = await commands.flagDelete(ctx, id);
    return reply.code(202).send(result);
  });

  // KILL SWITCH — instant kill for a flag
  app.post("/v1/admin/feature-flags/manage/:id/kill", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = safeParse(idParam, req.params);
    const result = await commands.flagKill(ctx, id);
    return reply.code(202).send(result);
  });
}
