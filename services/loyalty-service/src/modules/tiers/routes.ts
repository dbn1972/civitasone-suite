import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as enrolmentRepo from "../enrolments/repo.js";
import { evaluateTier, type TierDef } from "./domain.js";

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
  // GET /v1/loyalty/tiers/:enrolmentId — current tier for an enrolment
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

  // GET /v1/loyalty/tiers/:enrolmentId/history — tier assignment history
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

  // POST /v1/loyalty/tiers/evaluate — trigger tier re-evaluation for an enrolment
  app.post("/v1/loyalty/tiers/evaluate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = evaluateBody.parse(req.body);

    const enrolment = await enrolmentRepo.findById(body.enrolmentId, ctx.tenantId);
    if (!enrolment) {
      throw new HttpError(404, "NOT_FOUND", "enrolment not found");
    }

    // Load tier definitions for this program
    const tierDefs = await repo.listDefinitions(ctx.tenantId, body.programId);
    const currentAssignment = await repo.findCurrentAssignment(ctx.tenantId, body.enrolmentId);

    const defs: TierDef[] = tierDefs.map((d) => ({
      id: d.id,
      name: d.name,
      level: d.level,
      minPointsThreshold: d.minPointsThreshold,
    }));

    const result = evaluateTier(enrolment.lifetimePoints, defs, currentAssignment?.tierDefinitionId ?? null);

    if (result.changed && result.newTierId) {
      const assignmentId = randomUUID();
      await db.transaction(async (tx) => {
        await repo.insertAssignment(tx, {
          id: assignmentId,
          tenantId: ctx.tenantId,
          enrolmentId: body.enrolmentId,
          tierDefinitionId: result.newTierId,
          assignedAt: new Date(),
        });

        await enrolmentRepo.update(
          tx,
          body.enrolmentId,
          ctx.tenantId,
          { tier: result.newTierName, updatedBy: ctx.actorId },
          enrolment.version,
        );

        await enqueue(tx, {
          topic: EVENTS.tierChanged,
          eventType: EVENTS.tierChanged,
          tenantId: ctx.tenantId,
          actorId: ctx.actorId,
          correlationId: ctx.correlationId,
          payload: {
            enrolmentId: body.enrolmentId,
            previousTierId: currentAssignment?.tierDefinitionId ?? null,
            newTierId: result.newTierId,
            direction: result.direction,
          },
        });
      });
    }

    return reply.send({
      data: {
        enrolmentId: body.enrolmentId,
        programId: body.programId,
        newTier: result.newTierName,
        newLevel: result.newLevel,
        changed: result.changed,
        direction: result.direction,
      },
    });
  });
}
