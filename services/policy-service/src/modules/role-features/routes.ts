/**
 * Role Features module HTTP routes (Fastify plugin).
 * Manage feature visibility grants per role.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import { db, readScoped } from "../../shared/db.js";
import * as commands from "./commands.js";
import { grantFeatureBody, roleParam, grantIdParam, evaluateQuery } from "./validators.js";
import { roleFeatureGrants } from "./schema.js";
import { eq, and, inArray } from "drizzle-orm";

const ADMIN_ROLES = ["platform_admin", "super_admin", "tenant_admin"];
const RESOURCE = "role_feature_grant";

function safeParse<O>(schema: z.ZodType<O, z.ZodTypeDef, unknown>, data: unknown): O {
  const result = schema.safeParse(data);
  if (!result.success) {
    const msg = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new HttpError(400, "VALIDATION_FAILED", msg);
  }
  return result.data;
}

export async function roleFeatureRoutes(app: FastifyInstance): Promise<void> {
  // LIST all grants for tenant
  app.get("/v1/policy/role-features", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const rows = await cache.getOrLoad(
      cache.makeKey(ctx.tenantId, RESOURCE, "list"),
      async () => readScoped(ctx.tenantId, (tx) => tx.select().from(roleFeatureGrants).where(eq(roleFeatureGrants.tenantId, ctx.tenantId))),
    );
    return reply.send({ data: rows });
  });

  // GET features granted to a specific role
  app.get("/v1/policy/role-features/by-role/:role", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { role } = safeParse(roleParam, req.params);
    const rows = await readScoped(ctx.tenantId, (tx) => tx.select().from(roleFeatureGrants)
      .where(and(eq(roleFeatureGrants.tenantId, ctx.tenantId), eq(roleFeatureGrants.roleName, role))));
    return reply.send({ data: rows });
  });

  // GRANT a feature to a role
  app.post("/v1/policy/role-features", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = safeParse(grantFeatureBody, req.body);
    const result = await commands.grantFeature(ctx, body);
    return reply.code(202).send(result);
  });

  // REVOKE a grant
  app.delete("/v1/policy/role-features/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = safeParse(grantIdParam, req.params);
    const result = await commands.revokeFeature(ctx, id);
    return reply.code(202).send(result);
  });

  // EVALUATE — given roles[], return combined visible features
  app.get("/v1/policy/role-features/evaluate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { roles } = safeParse(evaluateQuery, req.query);
    const rows = await readScoped(ctx.tenantId, (tx) => tx.select().from(roleFeatureGrants)
      .where(and(
        eq(roleFeatureGrants.tenantId, ctx.tenantId),
        inArray(roleFeatureGrants.roleName, roles),
        eq(roleFeatureGrants.granted, true),
      )));
    const featureKeys = [...new Set(rows.map((r) => r.featureKey))];
    return reply.send({ data: featureKeys, roles });
  });
}
