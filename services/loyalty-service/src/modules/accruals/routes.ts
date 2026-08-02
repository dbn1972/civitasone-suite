import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as enrolmentRepo from "../enrolments/repo.js";
import { validateAccrual } from "./domain.js";
import { canAccrue } from "../enrolments/domain.js";
import * as commands from "./commands.js";

const INTERNAL_ROLES = ["loyalty_admin", "super_admin", "service_account"];
const READ_ROLES = ["loyalty_user", "loyalty_admin", "super_admin"];

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const idParam = z.object({ id: z.string().uuid() });

const accrueBody = z.object({
  enrolmentId: z.string().uuid(),
  points: z.coerce.number().int().positive(),
  source: z.string().min(1).max(100),
  sourceRef: z.string().max(200).optional(),
  txType: z.enum(["purchase", "bonus", "referral", "promotion", "adjustment"]).default("purchase"),
});

export async function accrualRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/loyalty/accrue", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INTERNAL_ROLES);
    const body = accrueBody.parse(req.body);

    const enrolment = await enrolmentRepo.findById(body.enrolmentId, ctx.tenantId);
    if (!enrolment) {
      throw new HttpError(404, "NOT_FOUND", "enrolment not found");
    }

    if (!canAccrue(enrolment.status as "active" | "suspended" | "cancelled")) {
      throw new HttpError(422, "ENROLMENT_NOT_ACTIVE", "enrolment is not active");
    }

    const pointsBigInt = BigInt(body.points);
    const validation = validateAccrual({
      points: pointsBigInt,
      source: body.source,
      txType: body.txType,
    });
    if (!validation.valid) {
      throw new HttpError(400, "VALIDATION_ERROR", validation.error!);
    }

    return reply.code(202).send(
      await commands.accruePoints(ctx, {
        enrolmentId: body.enrolmentId,
        points: body.points,
        source: body.source,
        sourceRef: body.sourceRef ?? null,
        txType: body.txType,
        enrolmentVersion: enrolment.version,
      }),
    );
  });

  app.get("/v1/loyalty/enrolments/:id/accruals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const q = listQuery.parse(req.query);

    const enrolment = await enrolmentRepo.findById(id, ctx.tenantId);
    if (!enrolment) {
      throw new HttpError(404, "NOT_FOUND", "enrolment not found");
    }

    const { rows, total } = await repo.listByEnrolment(ctx.tenantId, id, q.limit, q.offset);
    const page = Math.floor(q.offset / q.limit) + 1;

    return reply.send({ data: rows.map(repo.toView), meta: { page, pageSize: q.limit, total } });
  });

  app.get("/v1/loyalty/enrolments/:id/balance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);

    const enrolment = await enrolmentRepo.findById(id, ctx.tenantId);
    if (!enrolment) {
      throw new HttpError(404, "NOT_FOUND", "enrolment not found");
    }

    const summary = await repo.getBalanceSummary(ctx.tenantId, id);

    return reply.send({
      data: {
        enrolmentId: id,
        pointsBalance: enrolment.pointsBalance.toString(),
        lifetimePoints: enrolment.lifetimePoints.toString(),
        totalAccrued: summary.totalAccrued.toString(),
        activePoints: summary.activePoints.toString(),
      },
    });
  });
}
