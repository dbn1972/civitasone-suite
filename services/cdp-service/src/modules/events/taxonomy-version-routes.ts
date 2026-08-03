/**
 * events/taxonomy-version-routes.ts — CR-CDP-03 versioned event schema registry.
 *
 * Extends the CDP-004 registry: the event *name* and its governance status stay in
 * `cdp.event_taxonomy` (taxonomy-routes.ts); each revision of the attribute schema lives
 * here with its own draft → active → deprecated lifecycle. Validation resolves the active
 * revision, or an explicitly requested one, so an event captured under an older contract
 * can still be explained.
 *
 * Writes are queue-first (CQRS): the route validates and publishes; the F3 consumer
 * applies inserts / status transitions via markProcessed.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { publishF3Write } from "../../shared/f3-publish.js";
import * as taxonomyRepo from "./taxonomy-repo.js";
import * as repo from "./taxonomy-version-repo.js";
import { validateSchemaDefinition } from "./taxonomy-domain.js";
import {
  canTransitionVersion,
  nextSchemaVersion,
  selectActiveVersion,
  diffSchemas,
  validateAgainstVersion,
} from "./taxonomy-version-domain.js";

const READ_ROLES = ["cdp_user", "cdp_steward", "cdp_admin", "super_admin", "tenant_admin"];
const WRITE_ROLES = ["cdp_admin", "super_admin", "tenant_admin"];
/** Activating a contract is a governance act, as approval is in CDP-004. */
const GOVERN_ROLES = ["cdp_steward", "cdp_admin", "super_admin", "tenant_admin"];

const idParam = z.object({ id: z.string().uuid() });
const versionParam = z.object({
  id: z.string().uuid(),
  schemaVersion: z.coerce.number().int().min(1),
});

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200),
  offset: z.coerce.number().int().min(0).default(0),
});

const createBody = z.object({
  schemaJson: z.record(z.unknown()).default({}),
  notes: z.string().min(1).max(500).optional(),
});

const lifecycleBody = z.object({ version: z.number().int().min(1) });

const validateBody = z.object({
  eventName: z.string().min(1).max(128),
  payload: z.record(z.unknown()).default({}),
  /** Omit to validate against the revision currently in force. */
  schemaVersion: z.number().int().min(1).optional(),
});

export async function eventTaxonomyVersionRoutes(app: FastifyInstance): Promise<void> {
  // GET /v1/cdp/events/taxonomy/:id/versions — revision history (CR-CDP-03)
  app.get("/v1/cdp/events/taxonomy/:id/versions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);
    const q = listQuery.parse(req.query);

    const taxonomy = await taxonomyRepo.findById(id, ctx.tenantId);
    if (!taxonomy) throw new HttpError(404, "NOT_FOUND", "taxonomy definition not found");

    const { rows, total } = await repo.listPaged(id, ctx.tenantId, q.limit, q.offset);

    return reply.send({
      data: rows.map(repo.toView),
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total },
    });
  });

  // POST /v1/cdp/events/taxonomy/:id/versions — author a draft revision (CR-CDP-03)
  app.post("/v1/cdp/events/taxonomy/:id/versions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = createBody.parse(req.body);

    const taxonomy = await taxonomyRepo.findById(id, ctx.tenantId);
    if (!taxonomy) throw new HttpError(404, "NOT_FOUND", "taxonomy definition not found");

    const schemaError = validateSchemaDefinition(body.schemaJson);
    if (schemaError !== null) throw new HttpError(400, "INVALID_SCHEMA", schemaError);

    const existing = await repo.listByTaxonomy(id, ctx.tenantId);
    const schemaVersion = nextSchemaVersion(existing);
    const active = selectActiveVersion(existing);

    // The producer-impact report is computed against whatever is in force, so a reviewer
    // sees the consequence of the change before activating it — not after.
    const diff = diffSchemas(active?.schemaJson ?? {}, body.schemaJson);

    const versionId = randomUUID();
    await publishF3Write(ctx, "taxonomy_version_create", versionId, {
      taxonomyId: id,
      eventName: taxonomy.eventName,
      schemaVersion,
      schemaJson: body.schemaJson,
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      breaking: diff.breaking,
    });

    return reply.code(202).send({
      data: {
        id: versionId,
        taxonomyId: id,
        eventName: taxonomy.eventName,
        schemaVersion,
        status: "accepted",
        version: 1,
        comparedWith: active?.schemaVersion ?? null,
        diff,
        correlationId: ctx.correlationId,
      },
    });
  });

  // POST /v1/cdp/events/taxonomy/:id/versions/:schemaVersion/activate — put in force (CR-CDP-03)
  app.post("/v1/cdp/events/taxonomy/:id/versions/:schemaVersion/activate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, GOVERN_ROLES);
    const { id, schemaVersion } = versionParam.parse(req.params);
    const body = lifecycleBody.parse(req.body);

    const taxonomy = await taxonomyRepo.findById(id, ctx.tenantId);
    if (!taxonomy) throw new HttpError(404, "NOT_FOUND", "taxonomy definition not found");

    const target = await repo.findByVersionNumber(id, schemaVersion, ctx.tenantId);
    if (!target) throw new HttpError(404, "NOT_FOUND", "schema version not found");

    if (!canTransitionVersion(target.status, "active")) {
      throw new HttpError(422, "INVALID_TRANSITION", `cannot activate a ${target.status} schema version`);
    }

    await publishF3Write(ctx, "taxonomy_version_activate", target.id, {
      taxonomyId: id,
      eventName: taxonomy.eventName,
      schemaVersion,
      version: body.version,
      targetId: target.id,
    });

    return reply.code(202).send({
      data: {
        taxonomyId: id,
        eventName: taxonomy.eventName,
        schemaVersion,
        status: "accepted",
        version: body.version + 1,
        correlationId: ctx.correlationId,
      },
    });
  });

  // POST /v1/cdp/events/taxonomy/:id/versions/:schemaVersion/deprecate — retire (CR-CDP-03)
  app.post("/v1/cdp/events/taxonomy/:id/versions/:schemaVersion/deprecate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, GOVERN_ROLES);
    const { id, schemaVersion } = versionParam.parse(req.params);
    const body = lifecycleBody.parse(req.body);

    const taxonomy = await taxonomyRepo.findById(id, ctx.tenantId);
    if (!taxonomy) throw new HttpError(404, "NOT_FOUND", "taxonomy definition not found");

    const target = await repo.findByVersionNumber(id, schemaVersion, ctx.tenantId);
    if (!target) throw new HttpError(404, "NOT_FOUND", "schema version not found");

    if (!canTransitionVersion(target.status, "deprecated")) {
      throw new HttpError(422, "INVALID_TRANSITION", `cannot deprecate a ${target.status} schema version`);
    }

    await publishF3Write(ctx, "taxonomy_version_deprecate", target.id, {
      taxonomyId: id,
      eventName: taxonomy.eventName,
      schemaVersion,
      version: body.version,
      targetId: target.id,
    });

    return reply.code(202).send({
      data: {
        taxonomyId: id,
        eventName: taxonomy.eventName,
        schemaVersion,
        status: "accepted",
        version: body.version + 1,
        correlationId: ctx.correlationId,
      },
    });
  });

  // POST /v1/cdp/events/validate-versioned — validate against a specific revision (CR-CDP-03)
  app.post("/v1/cdp/events/validate-versioned", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const body = validateBody.parse(req.body);

    const taxonomy = await taxonomyRepo.findByEventName(body.eventName, ctx.tenantId);
    // 422 rather than 404: the request is well formed, the event name is ungoverned.
    if (!taxonomy) {
      throw new HttpError(422, "UNKNOWN_EVENT_NAME", `event "${body.eventName}" is not in the taxonomy`);
    }

    const versions = await repo.listByTaxonomy(taxonomy.id, ctx.tenantId);

    const target = body.schemaVersion === undefined
      ? selectActiveVersion(versions)
      : versions.find((v) => v.schemaVersion === body.schemaVersion) ?? null;

    if (target === null) {
      if (body.schemaVersion === undefined) {
        throw new HttpError(
          422,
          "NO_ACTIVE_SCHEMA_VERSION",
          `event "${body.eventName}" has no active schema version`,
        );
      }
      // An explicitly named revision that does not exist is a bad reference: 404.
      throw new HttpError(404, "NOT_FOUND", `schema version ${body.schemaVersion} not found`);
    }

    const result = validateAgainstVersion(body.payload, target);
    if (!result.valid) {
      throw new HttpError(
        422,
        "PAYLOAD_SCHEMA_VIOLATION",
        `payload does not satisfy schema version ${target.schemaVersion} of "${body.eventName}"`,
      );
    }

    return reply.send({
      data: {
        eventName: body.eventName,
        schemaVersion: result.schemaVersion,
        schemaStatus: target.status,
        valid: true,
        unknownFields: result.unknownFields,
      },
    });
  });
}
