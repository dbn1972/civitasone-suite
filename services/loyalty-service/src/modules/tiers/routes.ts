import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as enrolmentRepo from "../enrolments/repo.js";
import * as commands from "./commands.js";

const READ_ROLES = ["loyalty_user", "loyalty_admin", "super_admin"];
const WRITE_ROLES = ["loyalty_admin", "super_admin"];

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const evaluateBody = z.object({
  enrolmentId: z.string().uuid(),
  programId: z.string().uuid(),
});

const enrolmentIdParam = z.object({ enrolmentId: z.string().uuid() });

export async function tierRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/loyalty/tiers/:enrolmentId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { enrolmentId } = enrolmentIdParam.parse(req.params);

    const enrolment = await enrolmentRepo.findById(enrolmentId, ctx.tenantId);
    if (!enrolment) {
      throw new HttpError(404, "NOT_FOUND", "enrolment not found");
    }

    const assignment = await repo.findCurrentAssignment(ctx.tenantId, enrolmentId);
    if (!assignment) {
      return reply.send({ data: { enrolmentId, tier: enrolment.tier, assignment: null } });
    }

    return reply.send({ data: { enrolmentId, tier: enrolment.tier, assignment: repo.toAssignmentView(assignment) } });
  });

  app.get("/v1/loyalty/tiers/:enrolmentId/history", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { enrolmentId } = enrolmentIdParam.parse(req.params);
    const q = listQuery.parse(req.query);

    const enrolment = await enrolmentRepo.findById(enrolmentId, ctx.tenantId);
    if (!enrolment) {
      throw new HttpError(404, "NOT_FOUND", "enrolment not found");
    }

    const { rows, total } = await repo.listAssignmentHistory(ctx.tenantId, enrolmentId, q.limit, q.offset);
    const page = Math.floor(q.offset / q.limit) + 1;

    return reply.send({ data: rows.map(repo.toAssignmentView), meta: { page, pageSize: q.limit, total } });
  });

  app.post("/v1/loyalty/tiers/evaluate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = evaluateBody.parse(req.body);

    const enrolment = await enrolmentRepo.findById(body.enrolmentId, ctx.tenantId);
    if (!enrolment) {
      throw new HttpError(404, "NOT_FOUND", "enrolment not found");
    }

    return reply.code(202).send(
      await commands.evaluateTier(ctx, {
        enrolmentId: body.enrolmentId,
        programId: body.programId,
      }),
    );
  });
}
