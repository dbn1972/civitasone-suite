/**
 * profiles/template-routes.ts — CR-CDP-01 vertical profile templates + conflict rules.
 *
 * Write pattern follows the rest of cdp-service: validate with zod at the boundary, do
 * the authoritative write inside one `db.transaction`, and emit the domain event plus the
 * audit record through the outbox in the same transaction. No command is published for
 * work the route has already done.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./template-repo.js";
import * as profilesRepo from "./repo.js";
import {
  CONFLICT_STRATEGIES,
  validateAttributeSpecs,
  validateConflictRules,
  toAttributeSpecs,
  toConflictRules,
  applyTemplate,
  type ConflictStrategy,
  type SourceValue,
  type TemplateSpec,
} from "./template-domain.js";
import type { ProfileTemplateRow } from "./schema.js";

const READ_ROLES = ["cdp_user", "cdp_steward", "cdp_admin", "super_admin", "tenant_admin"];
const WRITE_ROLES = ["cdp_admin", "super_admin", "tenant_admin"];

const idParam = z.object({ id: z.string().uuid() });

/** `limit` is mandatory: an unbounded list of tenant configuration is still unbounded. */
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200),
  offset: z.coerce.number().int().min(0).default(0),
  vertical: z.string().min(1).max(64).optional(),
  profileType: z.string().min(1).max(32).optional(),
});

const strategyEnum = z.enum(CONFLICT_STRATEGIES);

const createBody = z.object({
  vertical: z.string().min(1).max(64).regex(/^[a-z][a-z0-9_-]*$/, "vertical must be lower kebab/snake case"),
  profileType: z.string().min(1).max(32).default("individual"),
  label: z.string().min(1).max(160),
  attributes: z.array(z.record(z.unknown())).max(200).default([]),
  conflictRules: z.record(z.record(z.unknown())).default({}),
  defaultStrategy: strategyEnum.default("most_recent"),
  sourcePriority: z.array(z.string().min(1).max(64)).max(50).default([]),
});

const updateBody = z.object({
  label: z.string().min(1).max(160).optional(),
  attributes: z.array(z.record(z.unknown())).max(200).optional(),
  conflictRules: z.record(z.record(z.unknown())).optional(),
  defaultStrategy: strategyEnum.optional(),
  sourcePriority: z.array(z.string().min(1).max(64)).max(50).optional(),
  version: z.number().int().min(1),
});

const candidateSchema = z.object({
  attribute: z.string().min(1).max(64),
  value: z.unknown(),
  source: z.string().min(1).max(64),
  observedAt: z.string().datetime(),
});

const resolveBody = z.object({
  candidates: z.array(candidateSchema).min(1).max(500),
});

const applyBody = z.object({
  templateId: z.string().uuid(),
  candidates: z.array(candidateSchema).min(1).max(500),
  version: z.number().int().min(1),
});

/** Build the pure-domain view of a stored template row. */
function toSpec(row: ProfileTemplateRow): TemplateSpec {
  const attributes = toAttributeSpecs(row.attributesSpec);
  const defaultStrategy = (CONFLICT_STRATEGIES as readonly string[]).includes(row.defaultStrategy)
    ? (row.defaultStrategy as ConflictStrategy)
    : "most_recent";
  return {
    attributes,
    conflictRules: toConflictRules(row.conflictRules, defaultStrategy, row.sourcePriority),
    defaultStrategy,
    sourcePriority: row.sourcePriority,
  };
}

function toSourceValues(candidates: Array<z.infer<typeof candidateSchema>>): SourceValue[] {
  return candidates.map((c) => ({
    attribute: c.attribute,
    value: c.value,
    source: c.source,
    observedAt: c.observedAt,
  }));
}

/** Shared validation for create and patch. Throws 400 with the domain's own message. */
function assertSpecValid(attributes: Array<Record<string, unknown>>, conflictRules: Record<string, unknown>): void {
  const attrError = validateAttributeSpecs(attributes);
  if (attrError !== null) throw new HttpError(400, "INVALID_ATTRIBUTE_SPEC", attrError);

  const names = attributes
    .map((a) => a.name)
    .filter((n): n is string => typeof n === "string");
  const ruleError = validateConflictRules(conflictRules, names);
  if (ruleError !== null) throw new HttpError(400, "INVALID_CONFLICT_RULES", ruleError);
}

export async function profileTemplateRoutes(app: FastifyInstance): Promise<void> {
  // GET /v1/cdp/profile-templates — list templates (CR-CDP-01)
  app.get("/v1/cdp/profile-templates", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = listQuery.parse(req.query);

    const { rows, total } = await repo.listByTenant(ctx.tenantId, q.limit, q.offset, {
      ...(q.vertical !== undefined ? { vertical: q.vertical } : {}),
      ...(q.profileType !== undefined ? { profileType: q.profileType } : {}),
    });

    return reply.send({
      data: rows.map(repo.toView),
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total },
    });
  });

  // GET /v1/cdp/profile-templates/:id — one template (CR-CDP-01)
  app.get("/v1/cdp/profile-templates/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);

    const row = await repo.findById(id, ctx.tenantId);
    if (!row) throw new HttpError(404, "NOT_FOUND", "profile template not found");

    return reply.send({ data: repo.toView(row) });
  });

  // POST /v1/cdp/profile-templates — register a template (CR-CDP-01)
  app.post("/v1/cdp/profile-templates", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createBody.parse(req.body);

    assertSpecValid(body.attributes, body.conflictRules);

    const clash = await repo.findByVertical(body.vertical, body.profileType, ctx.tenantId);
    if (clash) {
      throw new HttpError(
        409,
        "DUPLICATE_TEMPLATE",
        `a ${body.profileType} template already exists for vertical "${body.vertical}"`,
      );
    }

    const id = randomUUID();
    await db.transaction(async (tx) => {
      await repo.insert(tx, {
        id,
        tenantId: ctx.tenantId,
        vertical: body.vertical,
        profileType: body.profileType,
        label: body.label,
        attributesSpec: body.attributes,
        conflictRules: body.conflictRules as Record<string, Record<string, unknown>>,
        defaultStrategy: body.defaultStrategy,
        sourcePriority: body.sourcePriority,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.profileTemplateCreated,
        eventType: EVENTS.profileTemplateCreated,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: {
          templateId: id,
          vertical: body.vertical,
          profileType: body.profileType,
          attributeCount: body.attributes.length,
        },
      });

      await enqueue(tx, {
        topic: "audit.event.record",
        eventType: "audit.event.record",
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: {
          service: "cdp",
          action: "profile_template_created",
          resourceType: "profile_template",
          resourceId: id,
          outcome: "success",
          metadata: { vertical: body.vertical, profileType: body.profileType },
        },
      });
    });

    return reply.code(201).send({
      data: {
        id,
        vertical: body.vertical,
        profileType: body.profileType,
        label: body.label,
        attributes: body.attributes,
        conflictRules: body.conflictRules,
        defaultStrategy: body.defaultStrategy,
        sourcePriority: body.sourcePriority,
        version: 1,
      },
    });
  });

  // PATCH /v1/cdp/profile-templates/:id — amend a template (CR-CDP-01)
  app.patch("/v1/cdp/profile-templates/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateBody.parse(req.body);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "profile template not found");

    // Rules are validated against the attribute list they will live beside, not against
    // the one they arrived with — patching only the attributes must not orphan a rule.
    const nextAttributes = body.attributes ?? existing.attributesSpec;
    const nextRules = body.conflictRules ?? existing.conflictRules;
    assertSpecValid(nextAttributes, nextRules);

    const patch: Partial<{
      label: string;
      attributesSpec: Array<Record<string, unknown>>;
      conflictRules: Record<string, Record<string, unknown>>;
      defaultStrategy: string;
      sourcePriority: string[];
      updatedBy: string;
    }> = { updatedBy: ctx.actorId };
    if (body.label !== undefined) patch.label = body.label;
    if (body.attributes !== undefined) patch.attributesSpec = body.attributes;
    if (body.conflictRules !== undefined) {
      patch.conflictRules = body.conflictRules as Record<string, Record<string, unknown>>;
    }
    if (body.defaultStrategy !== undefined) patch.defaultStrategy = body.defaultStrategy;
    if (body.sourcePriority !== undefined) patch.sourcePriority = body.sourcePriority;

    await db.transaction(async (tx) => {
      const ok = await repo.update(tx, id, ctx.tenantId, patch, body.version);
      if (!ok) {
        throw new HttpError(409, "VERSION_CONFLICT", "profile template has been modified; retry with current version");
      }

      await enqueue(tx, {
        topic: EVENTS.profileTemplateUpdated,
        eventType: EVENTS.profileTemplateUpdated,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { templateId: id, vertical: existing.vertical, changed: Object.keys(patch).filter((k) => k !== "updatedBy") },
      });

      await enqueue(tx, {
        topic: "audit.event.record",
        eventType: "audit.event.record",
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: {
          service: "cdp",
          action: "profile_template_updated",
          resourceType: "profile_template",
          resourceId: id,
          outcome: "success",
          metadata: { vertical: existing.vertical },
        },
      });
    });

    return reply.send({ data: { id, updated: true, version: body.version + 1 } });
  });

  // POST /v1/cdp/profile-templates/:id/resolve — dry-run the conflict rules (CR-CDP-01)
  app.post("/v1/cdp/profile-templates/:id/resolve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const body = resolveBody.parse(req.body);

    const row = await repo.findById(id, ctx.tenantId);
    if (!row) throw new HttpError(404, "NOT_FOUND", "profile template not found");

    const result = applyTemplate(toSpec(row), toSourceValues(body.candidates));

    // Nothing the caller sent belongs to this template: the request is well formed but
    // meaningless against this vertical, which is a 422 rather than an empty 200.
    if (result.decisions.length === 0 && result.ignoredAttributes.length > 0) {
      throw new HttpError(
        422,
        "TEMPLATE_MISMATCH",
        `none of the supplied attributes are declared by template "${row.vertical}"`,
      );
    }

    return reply.send({
      data: {
        templateId: id,
        vertical: row.vertical,
        attributes: result.attributes,
        decisions: result.decisions,
        missingRequired: result.missingRequired,
        ignoredAttributes: result.ignoredAttributes,
        typeViolations: result.typeViolations,
      },
    });
  });

  // POST /v1/cdp/profiles/:id/apply-template — write the resolved golden attributes (CR-CDP-01)
  app.post("/v1/cdp/profiles/:id/apply-template", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = applyBody.parse(req.body);

    const profile = await profilesRepo.findById(id, ctx.tenantId);
    if (!profile || profile.profileType === "merged") {
      throw new HttpError(404, "NOT_FOUND", "profile not found");
    }

    const template = await repo.findById(body.templateId, ctx.tenantId);
    if (!template) throw new HttpError(404, "NOT_FOUND", "profile template not found");

    const result = applyTemplate(toSpec(template), toSourceValues(body.candidates));

    // A golden profile that violates its own template is worse than one that is not
    // written at all: every downstream segment would inherit the breach.
    if (result.missingRequired.length > 0) {
      throw new HttpError(
        422,
        "REQUIRED_ATTRIBUTES_UNRESOLVED",
        `template "${template.vertical}" requires: ${result.missingRequired.join(", ")}`,
      );
    }

    // Provenance: one lineage entry per contributing source, deduplicated, so a later
    // dispute can be traced to the system that supplied the surviving value.
    const stampedAt = new Date().toISOString();
    const newLineage = [...new Set(result.decisions.map((d) => d.source))]
      .sort()
      .map((source) => ({ source, sourceId: `template:${template.id}`, timestamp: stampedAt }));

    await db.transaction(async (tx) => {
      const ok = await profilesRepo.update(
        tx,
        id,
        ctx.tenantId,
        {
          attributes: { ...profile.attributes, ...result.attributes },
          sourceLineage: [...profile.sourceLineage, ...newLineage],
          updatedBy: ctx.actorId,
        },
        body.version,
      );
      if (!ok) {
        throw new HttpError(409, "VERSION_CONFLICT", "profile has been modified; retry with current version");
      }

      await enqueue(tx, {
        topic: EVENTS.profileTemplateApplied,
        eventType: EVENTS.profileTemplateApplied,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        // Attribute *names* only. The values are customer PII and an event fans out to
        // services that have no lawful basis to hold them.
        payload: {
          profileId: id,
          templateId: template.id,
          vertical: template.vertical,
          resolved: result.decisions.map((d) => ({
            attribute: d.attribute,
            source: d.source,
            strategy: d.strategy,
            conflicted: d.conflicted,
          })),
          ignoredAttributes: result.ignoredAttributes,
        },
      });

      await enqueue(tx, {
        topic: "audit.event.record",
        eventType: "audit.event.record",
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: {
          service: "cdp",
          action: "profile_template_applied",
          resourceType: "profile",
          resourceId: id,
          outcome: "success",
          metadata: { templateId: template.id, vertical: template.vertical, attributeCount: result.decisions.length },
        },
      });
    });

    await cache.invalidate(cache.makeKey(ctx.tenantId, "profile", id));
    await cache.invalidate(cache.makeKey(ctx.tenantId, "profile_lineage", id));
    await cache.invalidate(cache.makeKey(ctx.tenantId, "profile_summary", id));

    return reply.send({
      data: {
        profileId: id,
        templateId: template.id,
        version: body.version + 1,
        applied: result.decisions.map((d) => ({
          attribute: d.attribute,
          source: d.source,
          strategy: d.strategy,
          conflicted: d.conflicted,
        })),
        ignoredAttributes: result.ignoredAttributes,
        typeViolations: result.typeViolations,
      },
    });
  });
}
