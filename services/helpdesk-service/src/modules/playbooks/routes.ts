/**
 * G13 Resolution Playbooks — HTTP routes.
 *
 * CQRS: every mutation validates with zod, publishes a command and returns 202.
 * Reads go through the Redis read-through cache in ./queries.ts.
 */
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as queries from "./queries.js";
import * as commands from "./commands.js";
import {
  canDeprecate,
  canEdit,
  canPublish,
  canCompleteRun,
  canCompleteStep,
  normaliseSteps,
  validateSteps,
  type MatchCriteria,
  type PlaybookStatus,
  type PlaybookStep,
  type RunStatus,
} from "./domain.js";
import {
  completeRunBody,
  completeStepBody,
  createPlaybookBody,
  idParam,
  lifecycleBody,
  listPlaybooksQuery,
  resolveQuery,
  runStepParams,
  startRunBody,
  updatePlaybookBody,
} from "./validators.js";

/** Curating playbooks is an administrative act. */
const ADMIN_ROLES = ["helpdesk_admin", "super_admin"];
/** Working a playbook is an agent act; admins can do it too. */
const AGENT_ROLES = ["helpdesk_agent", "helpdesk_admin", "super_admin"];

/**
 * Optimistic locking: reject early when the caller's expectedVersion no longer
 * matches. The consumer repeats the check inside its UPDATE's WHERE, so a race
 * that slips past this pre-check still cannot apply a stale write.
 */
function assertVersion(current: number, expected: number | undefined): void {
  if (expected !== undefined && expected !== current) {
    throw new HttpError(409, "VERSION_CONFLICT", `playbook has moved on (current version ${current})`);
  }
}

export async function playbookRoutes(app: FastifyInstance): Promise<void> {
  // ── Playbook CRUD ─────────────────────────────────────────────────────────

  app.post("/v1/helpdesk/playbooks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createPlaybookBody.parse(req.body);

    const steps = normaliseSteps(body.steps as PlaybookStep[]);
    const stepErrors = validateSteps(steps);
    if (stepErrors.length > 0) {
      throw new HttpError(422, "INVALID_PLAYBOOK_STEPS", stepErrors.join("; "));
    }

    const versionNumber = body.versionNumber ?? 1;
    const clash = await repo.findPlaybookByKeyVersion(ctx.tenantId, body.playbookKey, versionNumber);
    if (clash) {
      throw new HttpError(
        409,
        "DUPLICATE_PLAYBOOK_VERSION",
        `playbook '${body.playbookKey}' version ${versionNumber} already exists`,
      );
    }

    return reply.code(202).send(
      await commands.createPlaybook(ctx, {
        playbookKey: body.playbookKey,
        name: body.name,
        description: body.description ?? null,
        versionNumber,
        categoryId: body.categoryId ?? null,
        productCode: body.productCode ?? null,
        ticketType: body.ticketType ?? null,
        priority: body.priority ?? null,
        steps,
      }),
    );
  });

  app.get("/v1/helpdesk/playbooks", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, AGENT_ROLES);
    const q = listPlaybooksQuery.parse(req.query);
    const data = await queries.listPlaybooks(ctx.tenantId, {
      status: q.status,
      playbookKey: q.playbookKey,
      limit: q.limit,
      offset: q.offset,
    });
    return reply.send({
      data,
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total: data.length },
    });
  });

  /**
   * Resolution. Declared BEFORE /v1/helpdesk/playbooks/:id so "resolve" is
   * never captured as a uuid path param (it would fail uuid validation with a
   * 400 that hides the real endpoint).
   */
  app.get("/v1/helpdesk/playbooks/resolve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, AGENT_ROLES);
    const q = resolveQuery.parse(req.query);
    const criteria: MatchCriteria = {
      categoryId: q.categoryId ?? null,
      productCode: q.productCode ?? null,
      ticketType: q.ticketType ?? null,
      priority: q.priority ?? null,
    };
    const result = await queries.resolveForCriteria(ctx.tenantId, criteria);
    // No match is a 200 with data:null, not a 404 — "this ticket has no curated
    // playbook" is a normal answer, and a 404 would be indistinguishable from a
    // bad URL for callers.
    return reply.send({
      data: result.playbook,
      meta: { criteria: result.criteria, candidates: result.candidates, matched: result.playbook !== null },
    });
  });

  app.get("/v1/helpdesk/playbooks/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, AGENT_ROLES);
    const { id } = idParam.parse(req.params);
    const view = await queries.getPlaybook(ctx.tenantId, id);
    if (!view) throw new HttpError(404, "NOT_FOUND", "playbook not found");
    return reply.send({ data: view });
  });

  app.patch("/v1/helpdesk/playbooks/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updatePlaybookBody.parse(req.body);

    const existing = await repo.findPlaybook(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "playbook not found");
    assertVersion(existing.version, body.expectedVersion);
    if (!canEdit(existing.status as PlaybookStatus)) {
      throw new HttpError(
        409,
        "PLAYBOOK_NOT_DRAFT",
        "a published or deprecated playbook is immutable — create a new version instead",
      );
    }

    let steps: PlaybookStep[] | undefined;
    if (body.steps) {
      steps = normaliseSteps(body.steps as PlaybookStep[]);
      const stepErrors = validateSteps(steps);
      if (stepErrors.length > 0) {
        throw new HttpError(422, "INVALID_PLAYBOOK_STEPS", stepErrors.join("; "));
      }
    }

    const payload: Record<string, unknown> = {};
    if (body.name !== undefined) payload.name = body.name;
    if (body.description !== undefined) payload.description = body.description;
    if (body.categoryId !== undefined) payload.categoryId = body.categoryId;
    if (body.productCode !== undefined) payload.productCode = body.productCode;
    if (body.ticketType !== undefined) payload.ticketType = body.ticketType;
    if (body.priority !== undefined) payload.priority = body.priority;
    if (steps !== undefined) payload.steps = steps;
    if (body.expectedVersion !== undefined) payload.expectedVersion = body.expectedVersion;

    return reply.code(202).send(await commands.updatePlaybook(ctx, id, payload));
  });

  app.post("/v1/helpdesk/playbooks/:id/publish", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = lifecycleBody.parse(req.body ?? {});
    const existing = await repo.findPlaybook(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "playbook not found");
    assertVersion(existing.version, body.expectedVersion);
    if (!canPublish(existing.status as PlaybookStatus, existing.steps)) {
      throw new HttpError(
        422,
        "PLAYBOOK_NOT_PUBLISHABLE",
        "only a draft with at least one valid step can be published",
      );
    }
    return reply.code(202).send(
      await commands.publishPlaybook(ctx, id, {
        ...(body.expectedVersion !== undefined ? { expectedVersion: body.expectedVersion } : {}),
      }),
    );
  });

  app.post("/v1/helpdesk/playbooks/:id/deprecate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = lifecycleBody.parse(req.body ?? {});
    const existing = await repo.findPlaybook(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "playbook not found");
    assertVersion(existing.version, body.expectedVersion);
    if (!canDeprecate(existing.status as PlaybookStatus)) {
      throw new HttpError(422, "PLAYBOOK_NOT_PUBLISHED", "only a published playbook can be deprecated");
    }
    return reply.code(202).send(
      await commands.deprecatePlaybook(ctx, id, {
        ...(body.expectedVersion !== undefined ? { expectedVersion: body.expectedVersion } : {}),
      }),
    );
  });

  // ── Runs ──────────────────────────────────────────────────────────────────

  app.post("/v1/helpdesk/playbook-runs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, AGENT_ROLES);
    const body = startRunBody.parse(req.body);

    const ticket = await repo.findTicketCriteria(ctx.tenantId, body.ticketId);
    if (!ticket) throw new HttpError(404, "NOT_FOUND", "ticket not found");

    const existingRun = await repo.findRunByTicket(ctx.tenantId, body.ticketId);
    if (existingRun) {
      throw new HttpError(409, "RUN_ALREADY_EXISTS", "this ticket already has a playbook run");
    }

    let playbookId = body.playbookId;
    if (playbookId) {
      const playbook = await repo.findPlaybook(playbookId, ctx.tenantId);
      if (!playbook) throw new HttpError(404, "NOT_FOUND", "playbook not found");
      if (playbook.status !== "published") {
        throw new HttpError(422, "PLAYBOOK_NOT_PUBLISHED", "only a published playbook can be run");
      }
    } else {
      const resolved = await queries.resolveForCriteria(ctx.tenantId, {
        categoryId: ticket.categoryId,
        productCode: ticket.productCode,
        ticketType: ticket.ticketType,
        priority: ticket.priority,
      });
      if (!resolved.playbook) {
        throw new HttpError(422, "NO_MATCHING_PLAYBOOK", "no published playbook matches this ticket");
      }
      playbookId = resolved.playbook.id;
    }

    return reply
      .code(202)
      .send(await commands.startRun(ctx, { playbookId, ticketId: body.ticketId }));
  });

  app.get("/v1/helpdesk/playbook-runs/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, AGENT_ROLES);
    const { id } = idParam.parse(req.params);
    const view = await queries.getRun(ctx.tenantId, id);
    if (!view) throw new HttpError(404, "NOT_FOUND", "playbook run not found");
    return reply.send({ data: view });
  });

  app.post("/v1/helpdesk/playbook-runs/:id/steps/:stepId/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, AGENT_ROLES);
    const { id, stepId } = runStepParams.parse(req.params);
    const body = completeStepBody.parse(req.body ?? {});

    const run = await repo.findRun(id, ctx.tenantId);
    if (!run) throw new HttpError(404, "NOT_FOUND", "playbook run not found");
    if (!canCompleteStep(run.status as RunStatus)) {
      throw new HttpError(422, "RUN_NOT_IN_PROGRESS", `run is ${run.status}`);
    }
    const step = await repo.findRunStep(ctx.tenantId, id, stepId);
    if (!step) throw new HttpError(404, "NOT_FOUND", "step not found on this run");
    if (step.completedAt !== null) {
      throw new HttpError(409, "STEP_ALREADY_COMPLETE", "this step is already complete");
    }

    return reply.code(202).send(
      await commands.completeStep(ctx, id, stepId, { note: body.note ?? null }),
    );
  });

  app.post("/v1/helpdesk/playbook-runs/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, AGENT_ROLES);
    const { id } = idParam.parse(req.params);
    const body = completeRunBody.parse(req.body ?? {});

    const run = await repo.findRun(id, ctx.tenantId);
    if (!run) throw new HttpError(404, "NOT_FOUND", "playbook run not found");
    if (body.expectedVersion !== undefined && body.expectedVersion !== run.version) {
      throw new HttpError(409, "VERSION_CONFLICT", `run has moved on (current version ${run.version})`);
    }
    if (run.status === "completed") {
      throw new HttpError(409, "RUN_ALREADY_COMPLETE", "this run is already complete");
    }
    if (!canCompleteStep(run.status as RunStatus)) {
      throw new HttpError(422, "RUN_NOT_IN_PROGRESS", `run is ${run.status}`);
    }

    const steps = await repo.listRunSteps(ctx.tenantId, id);
    const states = steps.map(queries.toRunStepState);
    if (!canCompleteRun(states)) {
      const outstanding = states.filter((s) => s.mandatory && s.completedAt === null).map((s) => s.stepId);
      throw new HttpError(
        422,
        "MANDATORY_STEPS_OUTSTANDING",
        `mandatory steps still outstanding: ${outstanding.join(", ")}`,
      );
    }

    return reply.code(202).send(
      await commands.completeRun(ctx, id, {
        ...(body.expectedVersion !== undefined ? { expectedVersion: body.expectedVersion } : {}),
      }),
    );
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED",
        message: "invalid request",
        correlationId,
        retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply
        .code(err.status)
        .send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error in playbook routes");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
