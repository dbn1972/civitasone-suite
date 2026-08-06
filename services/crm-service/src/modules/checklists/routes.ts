/**
 * G7 — checklist-driven cases (BRD: exporter readiness, insurance proposal, B2B
 * onboarding). HTTP surface:
 *
 *   GET    /v1/crm/checklist-templates                  — list (templateKey / status filters)
 *   POST   /v1/crm/checklist-templates                  — create a DRAFT version (202)
 *   GET    /v1/crm/checklist-templates/:id              — read one
 *   PATCH  /v1/crm/checklist-templates/:id              — amend a DRAFT (202)
 *   POST   /v1/crm/checklist-templates/:id/publish      — put a version in force (202)
 *   POST   /v1/crm/checklist-templates/:id/deprecate    — retire a version (202)
 *   GET    /v1/crm/checklist-instances                  — list (subject / status filters)
 *   POST   /v1/crm/checklist-instances                  — raise one from a published template (202)
 *   GET    /v1/crm/checklist-instances/:id              — read one
 *   POST   /v1/crm/checklist-instances/:id/responses    — record answers, partial allowed (202)
 *   GET    /v1/crm/checklist-instances/:id/completion   — progress + outstanding items + score
 *
 * CQRS: every write validates with zod, publishes a command and answers 202. Nothing here
 * writes to Postgres. Reads go through the cached read model.
 *
 * Every precondition the consumer's guarded UPDATE enforces is ALSO checked here against
 * the row the route already read, because a 202 followed by a consumer that silently drops
 * the command tells the caller the operation succeeded when it did not. The consumer keeps
 * its guards regardless — this read is a snapshot and cannot be trusted to still hold when
 * the write lands.
 *
 * `subjectId` is NOT dereferenced. A checklist records what it was told to attach to;
 * joining across to onboarding / deals / contacts would couple this module to three others
 * for no gain, and the subject may legitimately be created moments later in the same flow.
 */
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { ChecklistDomainError, buildResponses, unknownQuestionIds } from "@civitasone/checklist";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { windowOf, listEnvelope } from "../../shared/list-query.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as repo from "./repo.js";
import {
  allowedNextTemplateStatuses,
  assertValidStructure,
  buildInstanceStructure,
  canTemplateTransition,
  completionOf,
  isPublishable,
  isTemplateEditable,
  isTemplateInstantiable,
  isTemplateStatus,
  nextVersionNumber,
  type TemplateStatus,
} from "./domain.js";
import {
  createInstanceBody,
  createTemplateBody,
  idParam,
  listInstancesQuery,
  listTemplatesQuery,
  submitResponsesBody,
  templateStatusBody,
  updateTemplateBody,
} from "./validators.js";
import type { ChecklistInstanceView, ChecklistTemplateView } from "./schema.js";

/** Reading a checklist is part of doing the work, so any CRM user may. */
const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];
/**
 * Authoring a template is configuration, not sales work: a checklist decides what every
 * customer in the tenant is asked, so it sits with the administrators.
 */
const TEMPLATE_ADMIN_ROLES = ["crm_admin", "super_admin", "tenant_admin"];

/** A domain-error code is a client-input problem here: the payload described an illegal template. */
function rethrowDomainError(err: unknown): never {
  if (err instanceof ChecklistDomainError) {
    throw new HttpError(400, err.code, err.message);
  }
  throw err;
}

/** Load a template or 404. A template in another tenant is invisible, not forbidden. */
async function loadTemplate(tenantId: string, id: string): Promise<ChecklistTemplateView> {
  const found = await queries.getTemplate(id, tenantId);
  if (!found) throw new HttpError(404, "NOT_FOUND", "checklist template not found");
  if (!isTemplateStatus(found.status)) {
    throw new HttpError(422, "INVALID_STATE", `stored status '${found.status}' is not recognised`);
  }
  return found;
}

async function loadInstance(tenantId: string, id: string): Promise<ChecklistInstanceView> {
  const found = await queries.getInstance(id, tenantId);
  if (!found) throw new HttpError(404, "NOT_FOUND", "checklist instance not found");
  return found;
}

/**
 * The consumer's UPDATE is guarded on `version`, so a stale value there is a silent no-op
 * after a 202. Reject it while the caller can still see it.
 */
function assertVersion(expected: number | undefined, actual: number, what: string): void {
  if (expected !== undefined && expected !== actual) {
    throw new HttpError(409, "VERSION_CONFLICT", `${what} is at version ${actual}, not ${expected}`);
  }
}

function assertTemplateTransition(from: TemplateStatus, to: TemplateStatus): void {
  if (canTemplateTransition(from, to)) return;
  const allowed = allowedNextTemplateStatuses(from);
  throw new HttpError(
    422,
    "INVALID_TRANSITION",
    allowed.length === 0
      ? `'${from}' is terminal; no further transitions are allowed`
      : `cannot move a template from '${from}' to '${to}' (allowed: ${allowed.join(", ")})`,
  );
}

export async function checklistRoutes(app: FastifyInstance): Promise<void> {
  // ── templates ───────────────────────────────────────────────────────────────────
  app.get("/v1/crm/checklist-templates", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = listTemplatesQuery.parse(req.query ?? {});
    const w = windowOf(q);
    const { rows, total } = await queries.listTemplates(ctx.tenantId, w.pageSize, w.offset, {
      ...(q.templateKey ? { templateKey: q.templateKey } : {}),
      ...(q.status ? { status: q.status } : {}),
    });
    return reply.send(listEnvelope(rows, w, total));
  });

  app.post("/v1/crm/checklist-templates", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TEMPLATE_ADMIN_ROLES);
    const body = createTemplateBody.parse(req.body);
    try {
      assertValidStructure(body.sections);
    } catch (err) {
      rethrowDomainError(err);
    }

    // Versioning is by row: a new draft for an existing key takes the next number, so
    // publishing it never overwrites a structure an instance already references.
    const highest = await repo.highestVersionNumber(body.templateKey, ctx.tenantId);
    const id = randomUUID();
    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.createTemplate(ctx, id, {
        templateKey: body.templateKey,
        name: body.name,
        description: body.description ?? null,
        sections: body.sections,
        versionNumber: nextVersionNumber(highest),
      }),
    );
  });

  app.get("/v1/crm/checklist-templates/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send({ data: await loadTemplate(ctx.tenantId, id) });
  });

  app.patch("/v1/crm/checklist-templates/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TEMPLATE_ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateTemplateBody.parse(req.body);
    const current = await loadTemplate(ctx.tenantId, id);
    assertVersion(body.version, current.version, "checklist template");

    if (!isTemplateEditable(current.status as TemplateStatus)) {
      throw new HttpError(
        422,
        "TEMPLATE_IMMUTABLE",
        `a '${current.status}' template cannot be edited — publish a new version instead`,
      );
    }
    if (body.sections !== undefined) {
      try {
        assertValidStructure(body.sections);
      } catch (err) {
        rethrowDomainError(err);
      }
    }

    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.updateTemplate(ctx, id, {
        name: body.name ?? null,
        description: body.description ?? null,
        sections: body.sections ?? null,
        version: current.version,
      }),
    );
  });

  app.post("/v1/crm/checklist-templates/:id/publish", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TEMPLATE_ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = templateStatusBody.parse(req.body ?? {});
    const current = await loadTemplate(ctx.tenantId, id);
    assertVersion(body.version, current.version, "checklist template");
    assertTemplateTransition(current.status as TemplateStatus, "published");

    // An empty checklist would be instantiable and instantly "complete", which is a
    // misleading record of having asked a customer nothing.
    if (!isPublishable(current.sections)) {
      throw new HttpError(
        422,
        "TEMPLATE_EMPTY",
        "a template must have at least one section with at least one question to be published",
      );
    }
    try {
      assertValidStructure(current.sections);
    } catch (err) {
      rethrowDomainError(err);
    }

    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.publishTemplate(ctx, id, {
        templateKey: current.templateKey,
        versionNumber: current.versionNumber,
        version: current.version,
      }),
    );
  });

  app.post("/v1/crm/checklist-templates/:id/deprecate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, TEMPLATE_ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = templateStatusBody.parse(req.body ?? {});
    const current = await loadTemplate(ctx.tenantId, id);
    assertVersion(body.version, current.version, "checklist template");
    assertTemplateTransition(current.status as TemplateStatus, "deprecated");

    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.deprecateTemplate(ctx, id, { version: current.version }),
    );
  });

  // ── instances ───────────────────────────────────────────────────────────────────
  app.get("/v1/crm/checklist-instances", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = listInstancesQuery.parse(req.query ?? {});
    const w = windowOf(q);
    const { rows, total } = await queries.listInstances(ctx.tenantId, w.pageSize, w.offset, {
      ...(q.subjectType ? { subjectType: q.subjectType } : {}),
      ...(q.subjectId ? { subjectId: q.subjectId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.templateKey ? { templateKey: q.templateKey } : {}),
    });
    return reply.send(listEnvelope(rows, w, total));
  });

  app.post("/v1/crm/checklist-instances", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const body = createInstanceBody.parse(req.body);

    const template = body.templateId
      ? await loadTemplate(ctx.tenantId, body.templateId)
      : await repo.findPublishedTemplateByKey(body.templateKey as string, ctx.tenantId);
    if (!template) {
      throw new HttpError(404, "NOT_FOUND", "no published checklist template for that key");
    }
    if (!isTemplateInstantiable(template.status as TemplateStatus)) {
      throw new HttpError(
        422,
        "TEMPLATE_NOT_PUBLISHED",
        `template is '${template.status}' — only a published template can be instantiated`,
      );
    }

    const open = await repo.findOpenInstance(
      ctx.tenantId,
      body.subjectType,
      body.subjectId,
      template.templateKey,
    );
    if (open) {
      throw new HttpError(
        409,
        "OPEN_INSTANCE_EXISTS",
        `an open '${template.templateKey}' checklist already exists for this subject`,
      );
    }

    const id = randomUUID();
    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.createInstance(ctx, id, {
        subjectType: body.subjectType,
        subjectId: body.subjectId,
        templateId: template.id,
        templateKey: template.templateKey,
        templateVersionNumber: template.versionNumber,
        // Frozen HERE, from the structure the caller was shown, and carried on the command
        // so the consumer writes exactly that even if a new version is published meanwhile.
        structure: buildInstanceStructure(template.sections),
      }),
    );
  });

  app.get("/v1/crm/checklist-instances/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send({ data: await loadInstance(ctx.tenantId, id) });
  });

  app.post("/v1/crm/checklist-instances/:id/responses", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = submitResponsesBody.parse(req.body);
    const current = await loadInstance(ctx.tenantId, id);
    assertVersion(body.version, current.version, "checklist instance");

    if (current.status !== "in_progress") {
      throw new HttpError(
        422,
        "INSTANCE_NOT_OPEN",
        `checklist is '${current.status}'; answers can only be recorded while it is in progress`,
      );
    }

    // A typo'd question id would otherwise be stored forever, invisible to the engine and
    // counted by nothing. Fail it at the boundary against the instance's FROZEN structure.
    const unknown = unknownQuestionIds(
      current.structure,
      body.answers.map((a) => a.questionId),
    );
    if (unknown.length > 0) {
      throw new HttpError(
        400,
        "UNKNOWN_QUESTION",
        `these question ids are not in this checklist: ${unknown.join(", ")}`,
        { unknownQuestionIds: unknown },
      );
    }

    // Answers to a currently-hidden question are accepted and stored: visibility can change
    // as earlier answers change, and discarding them would silently lose work. They are
    // never counted toward completion while hidden — the engine decides that, not the route.
    const responses = buildResponses(body.answers, new Date().toISOString());

    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.submitResponses(ctx, id, { responses, version: current.version }),
    );
  });

  app.get("/v1/crm/checklist-instances/:id/completion", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const instance = await loadInstance(ctx.tenantId, id);
    const state = completionOf(instance.structure, instance.responses);
    return reply.send({
      data: {
        instanceId: instance.id,
        status: instance.status,
        complete: state.complete,
        progressPercent: state.progressPercent,
        requiredTotal: state.requiredTotal,
        requiredAnswered: state.requiredAnswered,
        unansweredRequired: state.outstanding,
        sectionScores: state.sectionScores,
        score: state.score,
        availableSectionIds: state.availableSectionIds,
        lockedSectionIds: state.lockedSectionIds,
      },
    });
  });
}
