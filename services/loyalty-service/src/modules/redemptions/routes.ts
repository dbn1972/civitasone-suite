import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as enrolmentRepo from "../enrolments/repo.js";
import { validateRedemption, canVoid } from "./domain.js";
import * as commands from "./commands.js";

const READ_ROLES = ["loyalty_user", "loyalty_admin", "super_admin"];
const WRITE_ROLES = ["loyalty_admin", "super_admin"];
const ADMIN_ROLES = ["loyalty_admin", "super_admin"];

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  enrolmentId: z.string().uuid().optional(),
});

const idParam = z.object({ id: z.string().uuid() });

const redeemBody = z.object({
  enrolmentId: z.string().uuid(),
  points: z.coerce.number().int().positive(),
  rewardType: z.string().min(1).max(50),
});

const voidBody = z.object({
  reason: z.string().min(1).max(500),
  version: z.number().int().min(1),
});

export async function redemptionRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/loyalty/redeem", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = redeemBody.parse(req.body);

    const enrolment = await enrolmentRepo.findById(body.enrolmentId, ctx.tenantId);
    if (!enrolment) {
      throw new HttpError(404, "NOT_FOUND", "enrolment not found");
    }

    const pointsBigInt = BigInt(body.points);
    const validation = validateRedemption({
      requestedPoints: pointsBigInt,
      availableBalance: enrolment.pointsBalance,
      enrolmentStatus: enrolment.status,
    });
    if (!validation.valid) {
      throw new HttpError(422, "REDEMPTION_INVALID", validation.error!);
    }

    return reply.code(202).send(
      await commands.redeemPoints(ctx, {
        enrolmentId: body.enrolmentId,
        memberId: enrolment.profileId,
        points: body.points,
        rewardType: body.rewardType,
        enrolmentVersion: enrolment.version,
      }),
    );
  });

  app.post("/v1/loyalty/redemptions/:id/void", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = voidBody.parse(req.body);

    const redemption = await repo.findById(id, ctx.tenantId);
    if (!redemption) {
      throw new HttpError(404, "NOT_FOUND", "redemption not found");
    }

    if (!canVoid(redemption.status)) {
      throw new HttpError(422, "VOID_INVALID", `cannot void redemption in state ${redemption.status}`);
    }

    return reply.code(202).send(
      await commands.voidRedemption(ctx, id, {
        reason: body.reason,
        version: body.version,
        enrolmentId: redemption.enrolmentId,
        points: redemption.points.toString(),
      }),
    );
  });

  app.get("/v1/loyalty/redemptions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = listQuery.parse(req.query);

    if (q.enrolmentId) {
      const { rows, total } = await repo.listByEnrolment(ctx.tenantId, q.enrolmentId, q.limit, q.offset);
      const page = Math.floor(q.offset / q.limit) + 1;
      return reply.send({ data: rows.map(repo.toView), meta: { page, pageSize: q.limit, total } });
    }

    const { rows, total } = await repo.listByTenant(ctx.tenantId, q.limit, q.offset);
    const page = Math.floor(q.offset / q.limit) + 1;
    return reply.send({ data: rows.map(repo.toView), meta: { page, pageSize: q.limit, total } });
  });

  app.get("/v1/loyalty/redemptions/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);

    const redemption = await repo.findById(id, ctx.tenantId);
    if (!redemption) {
      throw new HttpError(404, "NOT_FOUND", "redemption not found");
    }

    return reply.send({ data: repo.toView(redemption) });
  });
}
