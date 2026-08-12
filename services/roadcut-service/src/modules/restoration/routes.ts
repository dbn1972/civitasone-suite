import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

const ADMIN_ROLES = ["roadcut_admin", "super_admin"];

const startBody = z.object({
  permitId: z.string().uuid(),
  startDate: z.string(),
});

const completeBody = z.object({
  quality: z.enum(["satisfactory", "unsatisfactory"]),
  endDate: z.string(),
});

const refundBody = z.object({
  decision: z.enum(["full_refund", "partial_refund", "forfeited"]),
  refundMinor: z.string().optional(),
});

const idParam = z.object({ id: z.string().uuid() });

export async function restorationRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/roadcut/restorations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = startBody.parse(req.body);
    return reply.code(202).send(await commands.startRestoration(ctx, body.permitId, body.startDate));
  });

  app.get("/v1/roadcut/restorations/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await repo.findById(id, ctx.tenantId);
    if (!row) throw new HttpError(404, "RESTORATION_NOT_FOUND", "Restoration record not found");
    return reply.send({ data: row });
  });

  app.post("/v1/roadcut/restorations/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = completeBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "RESTORATION_NOT_FOUND", "Restoration record not found");
    if (existing.quality !== "pending") {
      throw new HttpError(422, "ALREADY_COMPLETED", "Restoration already assessed");
    }
    return reply.code(202).send(await commands.completeRestoration(ctx, id, body.quality, body.endDate));
  });

  app.post("/v1/roadcut/restorations/:id/refund", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = refundBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "RESTORATION_NOT_FOUND", "Restoration record not found");
    if (existing.depositRefundStatus !== "held") {
      throw new HttpError(422, "ALREADY_DECIDED", "Deposit refund already decided");
    }
    return reply.code(202).send(
      await commands.decideDepositRefund(ctx, id, body.decision, body.refundMinor),
    );
  });
}
