import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as journeyRepo from "../journeys/repo.js";
import { validateEnrollment } from "./domain.js";

const JOURNEY_ROLES = ["journey_admin", "marketing_admin", "super_admin"];

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  journeyId: z.string().uuid().optional(),
  profileId: z.string().uuid().optional(),
  status: z.string().optional(),
});

const enrollBody = z.object({
  journeyId: z.string().uuid(),
  profileId: z.string().uuid(),
});

const idParam = z.object({ id: z.string().uuid() });

export async function executionRoutes(app: FastifyInstance): Promise<void> {
  // GET /v1/journeys/executions — list executions with filters
  app.get("/v1/journeys/executions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, JOURNEY_ROLES);
    const q = listQuery.parse(req.query);

    const { rows, total } = await repo.listByTenant(ctx.tenantId, q.limit, q.offset, {
      ...(q.journeyId !== undefined ? { journeyId: q.journeyId } : {}),
      ...(q.profileId !== undefined ? { profileId: q.profileId } : {}),
      ...(q.status !== undefined ? { status: q.status } : {}),
    });

    const page = Math.floor(q.offset / q.limit) + 1;
    return reply.send({
      data: rows.map(repo.toView),
      meta: { page, pageSize: q.limit, total },
    });
  });

  // GET /v1/journeys/executions/:id — get single execution
  app.get("/v1/journeys/executions/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, JOURNEY_ROLES);
    const { id } = idParam.parse(req.params);

    const execution = await repo.findById(id, ctx.tenantId);
    if (!execution) {
      throw new HttpError(404, "NOT_FOUND", "execution not found");
    }

    return reply.send({ data: repo.toView(execution) });
  });

  // POST /v1/journeys/executions/enroll — enroll a profile in a journey
  app.post("/v1/journeys/executions/enroll", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, JOURNEY_ROLES);
    const body = enrollBody.parse(req.body);

    // Validate journey exists and is active
    const journey = await journeyRepo.findById(body.journeyId, ctx.tenantId);
    if (!journey) {
      throw new HttpError(404, "NOT_FOUND", "journey not found");
    }

    const enrollError = validateEnrollment(journey.status);
    if (enrollError) {
      throw new HttpError(422, "ENROLLMENT_INVALID", enrollError);
    }

    const id = randomUUID();

    await db.transaction(async (tx) => {
      await repo.insert(tx, {
        id,
        tenantId: ctx.tenantId,
        journeyId: body.journeyId,
        profileId: body.profileId,
        status: "enrolled",
        currentStepIndex: 0,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.journeyStarted,
        eventType: "journey.execution.enrolled",
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { executionId: id, journeyId: body.journeyId, profileId: body.profileId },
      });
    });

    return reply.code(201).send({
      data: { id, journeyId: body.journeyId, profileId: body.profileId, status: "enrolled", currentStepIndex: 0 },
    });
  });
}
