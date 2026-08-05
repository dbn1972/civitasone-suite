import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { upsertQuotaBody } from "./quota-validators.js";
import * as quotaRepo from "./quota-repo.js";

const ADMIN = ["platform_admin", "super_admin", "tenant_admin"];

export async function quotaRoutes(app: FastifyInstance): Promise<void> {
  // GET /notifications/channels/quotas — list tenant's channel quotas (legacy)
  app.get("/notifications/channels/quotas", async (req, reply) => {
    const ctx = resolveContext(req);
    const rows = await quotaRepo.findAllForTenant(ctx.tenantId);
    return reply.send({ data: rows });
  });

  // GET /notifications/channel-quotas — view current usage vs limit per channel
  app.get("/notifications/channel-quotas", async (req, reply) => {
    const ctx = resolveContext(req);
    const rows = await quotaRepo.findAllForTenant(ctx.tenantId);
    return reply.send({ data: rows });
  });

  // GET /notifications/channel-quotas/usage — current usage summary per channel
  app.get("/notifications/channel-quotas/usage", async (req, reply) => {
    const ctx = resolveContext(req);
    const today = new Date().toISOString().slice(0, 10);
    const rows = await quotaRepo.findAllForTenant(ctx.tenantId);
    const usage = rows
      .filter((r) => r.periodStart <= today && r.periodEnd >= today)
      .map((r) => ({
        channel: r.channel,
        used: r.used,
        monthlyLimit: r.monthlyLimit,
        status: r.status,
        periodStart: r.periodStart,
        periodEnd: r.periodEnd,
        remainingPercent: r.status === "unlimited"
          ? 100
          : r.monthlyLimit > BigInt(0)
            ? Math.max(0, Number((r.monthlyLimit - r.used) * BigInt(100) / r.monthlyLimit))
            : 0,
      }));
    return reply.send({ data: usage });
  });

  // POST /notifications/channel-quotas — set/update a channel quota (platform_admin only)
  app.post("/notifications/channel-quotas", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const parsed = upsertQuotaBody.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "VALIDATION_FAILED", parsed.error.issues.map((i) => i.message).join("; "));
    }
    const body = parsed.data;

    const row = await db.transaction(async (tx) => {
      return quotaRepo.upsertQuota(tx, {
        tenantId: ctx.tenantId,
        channel: body.channel,
        monthlyLimit: BigInt(body.monthlyLimit),
        periodStart: body.periodStart,
        periodEnd: body.periodEnd,
        status: body.status ?? "active",
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });
    });

    return reply.send({ data: row });
  });

  // PUT /notifications/channels/quotas — set/update a channel quota (admin) [legacy]
  app.put("/notifications/channels/quotas", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const parsed = upsertQuotaBody.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "VALIDATION_FAILED", parsed.error.issues.map((i) => i.message).join("; "));
    }
    const body = parsed.data;

    const row = await db.transaction(async (tx) => {
      return quotaRepo.upsertQuota(tx, {
        tenantId: ctx.tenantId,
        channel: body.channel,
        monthlyLimit: BigInt(body.monthlyLimit),
        periodStart: body.periodStart,
        periodEnd: body.periodEnd,
        status: body.status ?? "active",
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });
    });

    return reply.send({ data: row });
  });
}
