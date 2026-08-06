/**
 * Journey template + stage vocabulary routes (G1 + G2, spec §25).
 *
 *   GET    /v1/crm/stage-vocabulary                    — list (canonical + this tenant's)
 *   GET    /v1/crm/stage-vocabulary/:id                — read one
 *   POST   /v1/crm/stage-vocabulary                    — add a tenant stage code
 *   PATCH  /v1/crm/stage-vocabulary/:id                — amend a tenant stage code
 *   DELETE /v1/crm/stage-vocabulary/:id                — remove a tenant stage code
 *   GET    /v1/crm/journey-templates                   — list (scope + status filters)
 *   GET    /v1/crm/journey-templates/:id               — read one version row
 *   GET    /v1/crm/journey-templates/:id/resolved      — parent + overrides, composed
 *   POST   /v1/crm/journey-templates                   — create a draft
 *   PATCH  /v1/crm/journey-templates/:id               — amend a draft
 *   DELETE /v1/crm/journey-templates/:id               — remove a draft
 *   POST   /v1/crm/journey-templates/:id/publish       — publish (optionally as a new version)
 *   POST   /v1/crm/journey-templates/:id/deprecate     — retire a published version
 *
 * Two rules are enforced here that the rest of the module cannot enforce alone:
 *
 *  1. A canonical stage code is IMMUTABLE — 422, for every role, including super_admin.
 *     A canonical vocabulary a tenant can rename is not canonical, so there is deliberately
 *     no role that can override this. Migration 0081 says the same thing at the table.
 *
 *  2. Every precondition the consumer's guarded UPDATE relies on is checked here too. A 202
 *     followed by a consumer that silently drops the command tells the caller the operation
 *     succeeded when it did not. The consumer keeps its guards regardless — the route's read
 *     is a snapshot and may be stale by the time the write lands.
 */
import type { FastifyInstance } from "fastify";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { listEnvelope, type ListWindow } from "../../shared/list-query.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import {
  canTransitionStatus,
  isEditable,
  nextVersionNumber,
  validateOverride,
  validateTemplateSteps,
  VIOLATIONS,
  type RuleViolation,
  type VocabularyEntry,
} from "./domain.js";
import * as repo from "./repo.js";
import {
  idParam,
  createStageBody,
  updateStageBody,
  stageListQuery,
  createTemplateBody,
  updateTemplateBody,
  publishTemplateBody,
  deprecateTemplateBody,
  templateListQuery,
} from "./validators.js";
import type { JourneyStep, JourneyTemplateView, StageVocabularyView } from "./schema.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];
/** The vocabulary and the templates are governance, not day-to-day sales data. */
const ADMIN_ROLES = ["crm_admin", "tenant_admin", "super_admin"];

/** Offset/limit pairs are reported back in the standard `meta` envelope. */
function windowOf(q: { limit: number; offset: number }): ListWindow {
  return { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, offset: q.offset };
}

/** Turn domain violations into the service's 422 envelope, first code wins. */
function raiseViolations(violations: RuleViolation[]): never {
  const first = violations[0]!;
  throw new HttpError(
    422,
    first.code,
    violations.map((v) => v.message).join("; "),
    { violations },
  );
}

function assertVersion(expected: number | undefined, actual: number): void {
  if (expected !== undefined && expected !== actual) {
    throw new HttpError(409, "VERSION_CONFLICT", `record is at version ${actual}, not ${expected}`);
  }
}

async function loadStage(tenantId: string, id: string): Promise<StageVocabularyView> {
  const found = await queries.getStage(id, tenantId);
  if (!found) throw new HttpError(404, "NOT_FOUND", "stage code not found");
  return found;
}

/**
 * THE G1 GUARD. Canonical rows are national property; they are visible to every tenant so
 * templates can reference them, which is exactly why the write path has to refuse them.
 */
function assertMutableStage(stage: StageVocabularyView): void {
  if (stage.governance === "canonical") {
    throw new HttpError(
      422,
      "CANONICAL_STAGE_IMMUTABLE",
      `stage code '${stage.stageCode}' is canonical and cannot be changed or removed by a tenant`,
      { stageCode: stage.stageCode, governance: stage.governance },
    );
  }
}

async function loadTemplate(tenantId: string, id: string): Promise<JourneyTemplateView> {
  const found = await queries.getTemplate(id, tenantId);
  if (!found) throw new HttpError(404, "NOT_FOUND", "journey template not found");
  return found;
}

/**
 * Validate a step list for a template that may be derived. A child is checked against its
 * parent's RESOLVED steps, so a grandchild cannot drop what its grandparent required.
 */
async function assertStepsValid(
  tenantId: string,
  steps: JourneyStep[],
  parentTemplateId: string | null,
  vocabulary: VocabularyEntry[],
): Promise<void> {
  if (parentTemplateId === null) {
    const violations = validateTemplateSteps(steps, vocabulary);
    if (violations.length > 0) raiseViolations(violations);
    return;
  }

  const parent = await queries.getResolvedTemplate(parentTemplateId, tenantId);
  if (parent === null) {
    throw new HttpError(
      422,
      VIOLATIONS.parentNotFound,
      `parent template ${parentTemplateId} was not found`,
      { parentTemplateId },
    );
  }
  if (!parent.ok) {
    throw new HttpError(
      422,
      "PARENT_TEMPLATE_INVALID",
      `parent template ${parentTemplateId} does not resolve: ${parent.violations.map((v) => v.message).join("; ")}`,
      { parentTemplateId, violations: parent.violations },
    );
  }

  const violations = validateOverride(parent.resolved.steps, steps, vocabulary);
  if (violations.length > 0) raiseViolations(violations);
}

export async function journeyRoutes(app: FastifyInstance): Promise<void> {
  // ── Stage vocabulary (G1) ────────────────────────────────────────────────────

  app.get("/v1/crm/stage-vocabulary", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = stageListQuery.parse(req.query ?? {});
    const { rows, total } = await queries.listStages(ctx.tenantId, q.limit, q.offset, {
      ...(q.governance !== undefined ? { governance: q.governance } : {}),
    });
    return reply.send(listEnvelope(rows, windowOf(q), total));
  });

  app.get("/v1/crm/stage-vocabulary/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send({ data: await loadStage(ctx.tenantId, id) });
  });

  app.post("/v1/crm/stage-vocabulary", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createStageBody.parse(req.body);

    const clash = await repo.findStageByCode(ctx.tenantId, body.stageCode);
    if (clash) {
      // A tenant code that shadowed a canonical one would give the same stage two meanings
      // in the same tenant — precisely the ambiguity the canonical vocabulary removes.
      if (clash.governance === "canonical") {
        throw new HttpError(
          422,
          "CANONICAL_STAGE_IMMUTABLE",
          `stage code '${body.stageCode}' is canonical and cannot be redefined by a tenant`,
          { stageCode: body.stageCode },
        );
      }
      throw new HttpError(
        409,
        "DUPLICATE_STAGE_CODE",
        `stage code '${body.stageCode}' already exists for this tenant`,
        { stageCode: body.stageCode },
      );
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.createStageCode(ctx, body));
  });

  app.patch("/v1/crm/stage-vocabulary/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateStageBody.parse(req.body);
    const current = await loadStage(ctx.tenantId, id);
    assertMutableStage(current);
    assertVersion(body.version, current.version);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateStageCode(ctx, id, body));
  });

  app.delete("/v1/crm/stage-vocabulary/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const current = await loadStage(ctx.tenantId, id);
    assertMutableStage(current);
    return sendAccepted(reply, acceptedResponseSchema, await commands.deleteStageCode(ctx, id));
  });

  // ── Journey templates (G2) ───────────────────────────────────────────────────

  app.get("/v1/crm/journey-templates", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = templateListQuery.parse(req.query ?? {});
    const { rows, total } = await queries.listTemplates(ctx.tenantId, q.limit, q.offset, {
      ...(q.templateKey !== undefined ? { templateKey: q.templateKey } : {}),
      ...(q.status !== undefined ? { status: q.status } : {}),
      ...(q.governance !== undefined ? { governance: q.governance } : {}),
      ...(q.product !== undefined ? { product: q.product } : {}),
      ...(q.region !== undefined ? { region: q.region } : {}),
      ...(q.businessUnit !== undefined ? { businessUnit: q.businessUnit } : {}),
    });
    return reply.send(listEnvelope(rows, windowOf(q), total));
  });

  app.get("/v1/crm/journey-templates/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send({ data: await loadTemplate(ctx.tenantId, id) });
  });

  /**
   * The effective template: the parent chain composed with each descendant's overrides.
   * A broken derivation answers 422 with the violation rather than a half-composed
   * definition, because a caller acting on half a journey is worse than a caller told no.
   */
  app.get("/v1/crm/journey-templates/:id/resolved", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const outcome = await queries.getResolvedTemplate(id, ctx.tenantId);
    if (outcome === null) throw new HttpError(404, "NOT_FOUND", "journey template not found");
    if (!outcome.ok) raiseViolations(outcome.violations);
    return reply.send({ data: outcome.resolved });
  });

  app.post("/v1/crm/journey-templates", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createTemplateBody.parse(req.body);
    const vocabulary = await queries.effectiveVocabulary(ctx.tenantId);
    await assertStepsValid(ctx.tenantId, body.steps, body.parentTemplateId ?? null, vocabulary);
    const versionNumber = nextVersionNumber(await repo.maxVersionNumber(ctx.tenantId, body.templateKey));
    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.createJourneyTemplate(ctx, body, versionNumber),
    );
  });

  app.patch("/v1/crm/journey-templates/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateTemplateBody.parse(req.body);
    const current = await loadTemplate(ctx.tenantId, id);

    if (!isEditable(current.status)) {
      throw new HttpError(
        422,
        "TEMPLATE_NOT_EDITABLE",
        `template is ${current.status}; publish a new version instead of editing a definition journeys already ran under`,
        { status: current.status },
      );
    }
    assertVersion(body.version, current.version);

    if (body.steps !== undefined) {
      const vocabulary = await queries.effectiveVocabulary(ctx.tenantId);
      await assertStepsValid(ctx.tenantId, body.steps, current.parentTemplateId, vocabulary);
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.updateJourneyTemplate(ctx, id, body));
  });

  app.delete("/v1/crm/journey-templates/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const current = await loadTemplate(ctx.tenantId, id);
    if (!isEditable(current.status)) {
      throw new HttpError(
        422,
        "TEMPLATE_NOT_DELETABLE",
        `template is ${current.status}; a published definition is history and is deprecated, not deleted`,
        { status: current.status },
      );
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.deleteJourneyTemplate(ctx, id));
  });

  /**
   * Publish. With no `steps` the draft becomes live in place. With `steps` a NEW version row
   * is created and the current row is superseded — never an in-place rewrite of a definition
   * that journey instances already reference.
   */
  app.post("/v1/crm/journey-templates/:id/publish", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = publishTemplateBody.parse(req.body ?? {});
    const current = await loadTemplate(ctx.tenantId, id);
    assertVersion(body.version, current.version);

    if (current.status === "deprecated") {
      throw new HttpError(
        422,
        "INVALID_STATUS_TRANSITION",
        "a deprecated template cannot be published; create a new template instead",
        { status: current.status, allowed: [] },
      );
    }
    if (body.steps === undefined && !canTransitionStatus(current.status, "published")) {
      throw new HttpError(
        422,
        "INVALID_STATUS_TRANSITION",
        `template is already ${current.status}; supply steps to publish a new version`,
        { status: current.status },
      );
    }

    let versionNumber = current.versionNumber;
    if (body.steps !== undefined) {
      const vocabulary = await queries.effectiveVocabulary(ctx.tenantId);
      await assertStepsValid(ctx.tenantId, body.steps, current.parentTemplateId, vocabulary);
      versionNumber = nextVersionNumber(await repo.maxVersionNumber(ctx.tenantId, current.templateKey));
    }

    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.publishJourneyTemplate(ctx, id, {
        steps: body.steps ?? null,
        versionNumber,
      }),
    );
  });

  app.post("/v1/crm/journey-templates/:id/deprecate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = deprecateTemplateBody.parse(req.body ?? {});
    const current = await loadTemplate(ctx.tenantId, id);
    assertVersion(body.version, current.version);

    if (!canTransitionStatus(current.status, "deprecated")) {
      throw new HttpError(
        422,
        "INVALID_STATUS_TRANSITION",
        `cannot deprecate a template that is ${current.status}`,
        { status: current.status },
      );
    }

    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.deprecateJourneyTemplate(ctx, id, body.reason ?? null),
    );
  });
}
