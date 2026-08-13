/**
 * Tenant extensions — config, modules, feature-flags, stats, billing.
 * Adds routes missing from the core tenant module.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db, readScoped } from "../../shared/db.js";
import { tenants, tenantQuotas, tenantConfigs } from "../tenant/schema.js";
import { eq, and } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";

const ADMIN  = ["platform_admin", "super_admin", "tenant_admin"];
const PLAT   = ["platform_admin", "super_admin"];

function safeParse<O>(schema: z.ZodType<O, z.ZodTypeDef, unknown>, data: unknown): O {
  const result = schema.safeParse(data);
  if (!result.success) throw new HttpError(400, "VALIDATION_FAILED", result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return result.data;
}

const tenantIdParam       = z.object({ tenantId: z.string().uuid() });
const configBody          = z.object({ settings: z.record(z.unknown()).optional() }).passthrough();
const modulesBody         = z.object({ modules: z.record(z.boolean()) });
const featureFlagsBody    = z.object({ featureFlags: z.record(z.boolean()) });
const billingBody         = z.object({ billing: z.record(z.unknown()) });

async function getOrInitConfig(tx: any, tenantId: string) {
  const [row] = await tx.select().from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId));
  if (!row) {
    await tx.insert(tenantConfigs).values({ tenantId, modules: {}, featureFlags: {}, billing: {}, updatedBy: null }).onConflictDoNothing();
    return { tenantId, modules: {}, featureFlags: {}, billing: {} };
  }
  return row;
}

export async function tenantExtensionRoutes(app: FastifyInstance): Promise<void> {
  // ── CONFIG (thin wrapper — mirrors the generic settings, structured) ──

  app.get("/v1/tenants/:tenantId/config", async (req, reply) => {
    const ctx = resolveContext(req);
    const { tenantId } = safeParse(tenantIdParam, req.params);
    if (ctx.tenantId !== tenantId && !ctx.roles.some((r) => PLAT.includes(r))) throw new HttpError(403, "FORBIDDEN", "cross-tenant");
    const cfg = await readScoped(tenantId, (tx) => getOrInitConfig(tx, tenantId));
    return reply.send(cfg);
  });

  app.patch("/v1/tenants/:tenantId/config", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { tenantId } = safeParse(tenantIdParam, req.params);
    const body = safeParse(configBody, req.body);
    await runWithTenant(tenantId, () =>
      db.transaction(async (tx) => {
        const existing = await getOrInitConfig(tx, tenantId);
        await tx.update(tenantConfigs).set({
          billing:  (body as any).billing      ?? existing.billing,
          modules:  (body as any).modules      ?? existing.modules,
          featureFlags: (body as any).featureFlags ?? existing.featureFlags,
          updatedAt: new Date(),
          updatedBy: ctx.actorId,
        }).where(eq(tenantConfigs.tenantId, tenantId));
      }),
    );
    return reply.code(202).send({ tenantId, status: "accepted", correlationId: ctx.correlationId });
  });

  // ── MODULES ──────────────────────────────────────────────────────────

  app.patch("/v1/tenants/:tenantId/modules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PLAT);
    const { tenantId } = safeParse(tenantIdParam, req.params);
    const { modules } = safeParse(modulesBody, req.body);
    await runWithTenant(tenantId, () =>
      db.transaction(async (tx) => {
        const existing = await getOrInitConfig(tx, tenantId);
        await tx.update(tenantConfigs).set({
          modules: { ...(existing.modules as object), ...modules },
          updatedAt: new Date(), updatedBy: ctx.actorId,
        }).where(eq(tenantConfigs.tenantId, tenantId));
      }),
    );
    return reply.code(202).send({ tenantId, status: "accepted", correlationId: ctx.correlationId });
  });

  // ── FEATURE FLAGS ─────────────────────────────────────────────────────

  app.get("/v1/tenants/:tenantId/feature-flags", async (req, reply) => {
    const ctx = resolveContext(req);
    if (ctx.tenantId !== req.params && !ctx.roles.some((r) => PLAT.includes(r))) throw new HttpError(403, "FORBIDDEN", "cross-tenant");
    const { tenantId } = safeParse(tenantIdParam, req.params);
    const cfg = await readScoped(tenantId, (tx) => getOrInitConfig(tx, tenantId));
    return reply.send({ tenantId, featureFlags: cfg.featureFlags });
  });

  app.patch("/v1/tenants/:tenantId/feature-flags", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PLAT);
    const { tenantId } = safeParse(tenantIdParam, req.params);
    const { featureFlags } = safeParse(featureFlagsBody, req.body);
    await runWithTenant(tenantId, () =>
      db.transaction(async (tx) => {
        const existing = await getOrInitConfig(tx, tenantId);
        await tx.update(tenantConfigs).set({
          featureFlags: { ...(existing.featureFlags as object), ...featureFlags },
          updatedAt: new Date(), updatedBy: ctx.actorId,
        }).where(eq(tenantConfigs.tenantId, tenantId));
      }),
    );
    return reply.code(202).send({ tenantId, status: "accepted", correlationId: ctx.correlationId });
  });

  // ── STATS ─────────────────────────────────────────────────────────────

  app.get("/v1/tenants/:tenantId/stats", async (req, reply) => {
    const ctx = resolveContext(req);
    const { tenantId } = safeParse(tenantIdParam, req.params);
    if (ctx.tenantId !== tenantId && !ctx.roles.some((r) => PLAT.includes(r))) throw new HttpError(403, "FORBIDDEN", "cross-tenant");
    const [quotaRow] = await readScoped(tenantId, (tx) =>
      tx.select().from(tenantQuotas).where(eq(tenantQuotas.tenantId, tenantId)),
    );
    return reply.send({
      tenantId,
      quotas:  quotaRow ?? null,
      timestamp: new Date().toISOString(),
    });
  });

  // ── BILLING ───────────────────────────────────────────────────────────

  app.get("/v1/tenants/:tenantId/billing", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { tenantId } = safeParse(tenantIdParam, req.params);
    const cfg = await readScoped(tenantId, (tx) => getOrInitConfig(tx, tenantId));
    return reply.send({ tenantId, billing: cfg.billing });
  });

  app.patch("/v1/tenants/:tenantId/billing", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PLAT);
    const { tenantId } = safeParse(tenantIdParam, req.params);
    const { billing } = safeParse(billingBody, req.body);
    await runWithTenant(tenantId, () =>
      db.transaction(async (tx) => {
        const existing = await getOrInitConfig(tx, tenantId);
        await tx.update(tenantConfigs).set({
          billing: { ...(existing.billing as object), ...billing },
          updatedAt: new Date(), updatedBy: ctx.actorId,
        }).where(eq(tenantConfigs.tenantId, tenantId));
      }),
    );
    return reply.code(202).send({ tenantId, status: "accepted", correlationId: ctx.correlationId });
  });
}
