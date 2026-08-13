import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { canDecideDeposit } from "./domain.js";

const ADMIN_ROLES = ["event_admin", "super_admin"];

const inspectionBody = z.object({
  permitId: z.string().uuid(),
  findings: z.record(z.unknown()),
  damageAssessment: z.record(z.unknown()).optional(),
});

const depositBody = z.object({
  decision: z.enum(["full_refund", "partial_refund", "forfeited"]),
  refundMinor: z.string().optional(),
});

const idParam = z.object({ id: z.string().uuid() });

export async function postEventRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/event/post-inspections", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = inspectionBody.parse(req.body);
    return reply.code(202).send(
      await commands.conductInspection(ctx, body.permitId, body.findings, body.damageAssessment),
    );
  });

  app.get("/v1/event/post-inspections/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await repo.findById(id, ctx.tenantId);
    if (!row) throw new HttpError(404, "INSPECTION_NOT_FOUND", "Post-event inspection not found");
    return reply.send({ data: row });
  });

  app.post("/v1/event/post-inspections/:id/deposit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = depositBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "INSPECTION_NOT_FOUND", "Post-event inspection not found");
    if (!canDecideDeposit(existing)) {
      throw new HttpError(422, "ALREADY_DECIDED", "Deposit already decided");
    }
    return reply.code(202).send(await commands.decideDeposit(ctx, id, body.decision, body.refundMinor));
  });
}
