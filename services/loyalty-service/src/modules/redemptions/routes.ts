import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as enrolmentRepo from "../enrolments/repo.js";
import { validateRedemption, canVoid, balanceAfterRedemption, balanceAfterVoid } from "./domain.js";
import { canRedeem } from "../enrolments/domain.js";

const READ_ROLES = ["loyalty_user", "loyalty_admin", "super_admin"];
const WRITE_ROLES = ["loyalty_user", "loyalty_admin", "super_admin"];
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
  // POST /v1/loyalty/redeem — redeem points
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

    const id = randomUUID();
    await db.transaction(async (tx) => {
      await repo.insert(tx, {
        id,
        tenantId: ctx.tenantId,
        // Denormalise the profile id so the legacy (tenant_id, member_id) index
        // keeps resolving redemptions per member without a join to enrolments.
        memberId: enrolment.profileId,
        enrolmentId: body.enrolmentId,
        points: pointsBigInt,
        rewardType: body.rewardType,
        status: "fulfilled",
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });

      // Deduct balance
      const newBalance = balanceAfterRedemption(enrolment.pointsBalance, pointsBigInt);
      await enrolmentRepo.adjustBalance(
        tx,
        body.enrolmentId,
        ctx.tenantId,
        -pointsBigInt,
        BigInt(0),
        enrolment.version,
      );

      await enqueue(tx, {
        topic: EVENTS.pointsRedeemed,
        eventType: EVENTS.pointsRedeemed,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { redemptionId: id, enrolmentId: body.enrolmentId, points: body.points },
      });
    });

    return reply.code(201).send({
      data: {
        id,
        memberId: enrolment.profileId,
        enrolmentId: body.enrolmentId,
        points: body.points.toString(),
        rewardType: body.rewardType,
        status: "fulfilled",
      },
    });
  });

  // POST /v1/loyalty/redemptions/:id/void — void a redemption
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

    await db.transaction(async (tx) => {
      const ok = await repo.voidRedemption(tx, id, ctx.tenantId, body.reason, ctx.actorId, body.version);
      if (!ok) {
        throw new HttpError(409, "VERSION_CONFLICT", "redemption has been modified; retry with current version");
      }

      // Restore balance to enrolment
      if (redemption.enrolmentId) {
        const enrolment = await enrolmentRepo.findById(redemption.enrolmentId, ctx.tenantId);
        if (enrolment) {
          await enrolmentRepo.adjustBalance(
            tx,
            redemption.enrolmentId,
            ctx.tenantId,
            redemption.points,
            BigInt(0),
            enrolment.version,
          );
        }
      }
    });

    return reply.send({ data: { id, status: "voided", version: body.version + 1 } });
  });

  // GET /v1/loyalty/redemptions — list redemptions
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

  // GET /v1/loyalty/redemptions/:id — get single redemption
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
