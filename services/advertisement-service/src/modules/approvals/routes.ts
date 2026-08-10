import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { canDecide } from "./domain.js";
import * as appRepo from "../applications/repo.js";

const OFFICER_ROLES = ["adv_admin", "adv_officer", "super_admin"];

const initiateBody = z.object({
  applicationId: z.string().uuid(),
  scrutinyType: z.enum(["zone_check", "structural_safety", "traffic_impact"]),
  officerId: z.string().uuid(),
});

const completeBody = z.object({
  findings: z.record(z.unknown()),
});

const decideBody = z.object({
  applicationId: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().optional(),
});

const idParam = z.object({ id: z.string().uuid() });

export async function approvalRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/advertisement/approvals/scrutiny", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const body = initiateBody.parse(req.body);
    const application = await appRepo.findById(body.applicationId, ctx.tenantId);
    if (!application) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
    if (application.status !== "submitted" && application.status !== "under_review") {
      throw new HttpError(422, "INVALID_STATUS", "Cannot scrutinize application in status '" + application.status + "'");
    }
    return reply.code(202).send(await commands.initiateScrutiny(ctx, body.applicationId, body.scrutinyType, body.officerId));
  });

  app.post("/v1/advertisement/approvals/scrutiny/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = completeBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "SCRUTINY_NOT_FOUND", "Scrutiny record not found");
    if (existing.status !== "pending") {
      throw new HttpError(422, "ALREADY_COMPLETED", "Scrutiny already completed");
    }
    return reply.code(202).send(await commands.completeScrutiny(ctx, id, body.findings));
  });

  app.post("/v1/advertisement/approvals/decide", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const body = decideBody.parse(req.body);
    const application = await appRepo.findById(body.applicationId, ctx.tenantId);
    if (!application) throw new HttpError(404, "APPLICATION_NOT_FOUND", "Application not found");
    if (!canDecide(application.status)) {
      throw new HttpError(422, "INVALID_STATUS", "Cannot decide application in status '" + application.status + "'");
    }
    return reply.code(202).send(await commands.decideApplication(ctx, body.applicationId, body.decision, body.reason));
  });
}
