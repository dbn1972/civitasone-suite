import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import * as regRepo from "../registrations/repo.js";

const ADMIN_ROLES = ["vendor_admin", "super_admin"];

const assignBody = z.object({
  registrationId: z.string().uuid(),
  committeeType: z.enum(["town_vending_committee", "zone_committee"]),
});

const completeBody = z.object({
  findings: z.record(z.unknown()),
  recommendation: z.enum(["approve", "reject", "defer", "allocate_zone"]),
});

const allocateBody = z.object({
  registrationId: z.string().uuid(),
  zone: z.string().min(1),
  spot: z.string().min(1),
});

const decideBody = z.object({
  registrationId: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().optional(),
});

const idParam = z.object({ id: z.string().uuid() });
const registrationIdQuery = z.object({ registrationId: z.string().uuid() });

export async function committeeRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/vendor/committee/reviews", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = assignBody.parse(req.body);
    const reg = await regRepo.findById(body.registrationId, ctx.tenantId);
    if (!reg) throw new HttpError(404, "REGISTRATION_NOT_FOUND", "Registration not found");
    if (reg.status !== "submitted" && reg.status !== "under_review") {
      throw new HttpError(422, "INVALID_STATUS", `Cannot review registration in status '${reg.status}'`);
    }
    return reply.code(202).send(
      await commands.assignCommitteeReview(ctx, body.registrationId, body.committeeType),
    );
  });

  app.get("/v1/vendor/committee/reviews", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const q = registrationIdQuery.parse(req.query);
    const records = await repo.listByRegistration(q.registrationId, ctx.tenantId);
    return reply.send({
      data: records,
      meta: { page: 1, pageSize: records.length, total: records.length },
    });
  });

  app.post("/v1/vendor/committee/reviews/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = completeBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "REVIEW_NOT_FOUND", "Committee review not found");
    if (existing.status !== "pending") {
      throw new HttpError(422, "ALREADY_COMPLETED", "Review already completed");
    }
    return reply.code(202).send(
      await commands.completeCommitteeReview(ctx, id, body.findings, body.recommendation),
    );
  });

  app.post("/v1/vendor/committee/allocate-zone", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = allocateBody.parse(req.body);
    const reg = await regRepo.findById(body.registrationId, ctx.tenantId);
    if (!reg) throw new HttpError(404, "REGISTRATION_NOT_FOUND", "Registration not found");
    if (reg.status !== "under_review") {
      throw new HttpError(422, "INVALID_STATUS", `Cannot allocate zone for registration in status '${reg.status}'`);
    }
    return reply.code(202).send(
      await commands.allocateZone(ctx, body.registrationId, body.zone, body.spot),
    );
  });

  app.post("/v1/vendor/committee/decide", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = decideBody.parse(req.body);
    const reg = await regRepo.findById(body.registrationId, ctx.tenantId);
    if (!reg) throw new HttpError(404, "REGISTRATION_NOT_FOUND", "Registration not found");
    if (!["under_review", "zone_allocated"].includes(reg.status)) {
      throw new HttpError(422, "INVALID_STATUS", `Cannot decide registration in status '${reg.status}'`);
    }
    if (body.decision === "rejected" && !body.reason) {
      throw new HttpError(422, "REASON_REQUIRED", "Reason is required for rejection");
    }
    const cmd = body.decision === "approved"
      ? commands.approveRegistration(ctx, body.registrationId)
      : commands.rejectRegistration(ctx, body.registrationId, body.reason!);
    return reply.code(202).send(await cmd);
  });
}
