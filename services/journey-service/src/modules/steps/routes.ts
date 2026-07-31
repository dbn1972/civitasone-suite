import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as journeyRepo from "../journeys/repo.js";
import { validateStepType, validateStepIndex } from "./domain.js";

const JOURNEY_ROLES = ["journey_admin", "marketing_admin", "super_admin"];

const journeyIdParam = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const executeStepBody = z.object({
  journeyId: z.string().uuid(),
  profileId: z.string().uuid(),
  stepIndex: z.number().int().min(0),
  stepType: z.string().min(1),
});

export async function stepRoutes(app: FastifyInstance): Promise<void> {
  // GET /v1/journeys/:id/steps — list step executions for a journey
  app.get("/v1/journeys/:id/steps", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, JOURNEY_ROLES);
    const { id } = journeyIdParam.parse(req.params);
    const q = listQuery.parse(req.query);

    const journey = await journeyRepo.findById(id, ctx.tenantId);
    if (!journey) {
      throw new HttpError(404, "NOT_FOUND", "journey not found");
    }

    const { rows, total } = await repo.listByJourney(id, ctx.tenantId, q.limit, q.offset);
    const page = Math.floor(q.offset / q.limit) + 1;

    return reply.send({
      data: rows.map(repo.toView),
      meta: { page, pageSize: q.limit, total },
    });
  });

  // POST /v1/journeys/steps/execute — execute a step for a profile
  app.post("/v1/journeys/steps/execute", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, JOURNEY_ROLES);
    const body = executeStepBody.parse(req.body);

    // Validate step type
    const typeError = validateStepType(body.stepType);
    if (typeError) {
      throw new HttpError(400, "INVALID_STEP_TYPE", typeError);
    }

    // Validate journey exists
    const journey = await journeyRepo.findById(body.journeyId, ctx.tenantId);
    if (!journey) {
      throw new HttpError(404, "NOT_FOUND", "journey not found");
    }

    // Validate step index
    const indexError = validateStepIndex(body.stepIndex, journey.steps.length);
    if (indexError) {
      throw new HttpError(400, "INVALID_STEP_INDEX", indexError);
    }

    const id = randomUUID();

    await db.transaction(async (tx) => {
      await repo.insert(tx, {
        id,
        tenantId: ctx.tenantId,
        journeyId: body.journeyId,
        profileId: body.profileId,
        stepIndex: body.stepIndex,
        status: "executing",
        executedAt: new Date(),
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.stepCompleted,
        eventType: EVENTS.stepCompleted,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { stepExecutionId: id, journeyId: body.journeyId, profileId: body.profileId, stepIndex: body.stepIndex },
      });
    });

    return reply.code(201).send({
      data: { id, journeyId: body.journeyId, profileId: body.profileId, stepIndex: body.stepIndex, status: "executing" },
    });
  });
}
