import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as journeyRepo from "../journeys/repo.js";
import { validateStepType, validateStepIndex } from "./domain.js";
import * as commands from "./commands.js";

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
  /** Attributes a `condition_check` step evaluates against. */
  context: z.record(z.unknown()).optional(),
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

    // The journey definition — not the request — decides what this step does.
    // Without this check a caller holding execute permission could ask for a
    // different action than the step the journey actually declares, and the
    // config the consumer dispatches on comes from the stored definition only.
    const step = journey.steps[body.stepIndex] ?? {};
    const declaredType = typeof step["type"] === "string" ? (step["type"] as string) : null;
    if (declaredType !== null && declaredType !== body.stepType) {
      throw new HttpError(
        422,
        "STEP_TYPE_MISMATCH",
        `step ${body.stepIndex} of this journey is '${declaredType}', not '${body.stepType}'`,
      );
    }

    const rawConfig = step["config"];
    const stepConfig =
      rawConfig !== null && typeof rawConfig === "object" && !Array.isArray(rawConfig)
        ? (rawConfig as Record<string, unknown>)
        : {};

    return reply.code(202).send(
      await commands.executeStep(ctx, {
        journeyId: body.journeyId,
        profileId: body.profileId,
        stepIndex: body.stepIndex,
        stepType: body.stepType,
        stepConfig,
        totalSteps: journey.steps.length,
        ...(body.context !== undefined ? { context: body.context } : {}),
      }),
    );
  });
}
