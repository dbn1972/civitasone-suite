/**
 * events/taxonomy-routes.ts — CDP-004 event taxonomy governance + payload validation.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./taxonomy-repo.js";
import { validateSchemaDefinition, validatePayload, canTransition } from "./taxonomy-domain.js";

const READ_ROLES = ["cdp_user", "cdp_steward", "cdp_admin", "super_admin", "tenant_admin"];
const WRITE_ROLES = ["cdp_admin", "super_admin", "tenant_admin"];
/** Approval is a governance act, so it needs the data-steward or admin authority. */
const APPROVE_ROLES = ["cdp_steward", "cdp_admin", "super_admin", "tenant_admin"];

const idParam = z.object({ id: z.string().uuid() });

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(["draft", "approved", "deprecated"]).optional(),
  category: z.string().min(1).max(64).optional(),
});

const createBody = z.object({
  // Event names are lower snake/dot case by convention; enforcing it at the boundary is
  // what stops `order_placed` and `Order Placed` becoming two behaviours.
  eventName: z.string().min(1).max(128).regex(/^[a-z][a-z0-9_.]*$/, "eventName must be lower_snake_case or dotted"),
  category: z.string().min(1).max(64).default("behavioural"),
  schemaJson: z.record(z.unknown()).default({}),
});

const updateBody = z.object({
  category: z.string().min(1).max(64).optional(),
  schemaJson: z.record(z.unknown()).optional(),
  status: z.enum(["draft", "approved", "deprecated"]).optional(),
  version: z.number().int().min(1),
});

const approveBody = z.object({ version: z.number().int().min(1) });

const validateBody = z.object({
  eventName: z.string().min(1).max(128),
  payload: z.record(z.unknown()).default({}),
});

export async function eventTaxonomyRoutes(app: FastifyInstance): Promise<void> {
  // GET /v1/cdp/events/taxonomy — list definitions (CDP-004)
  app.get("/v1/cdp/events/taxonomy", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = listQuery.parse(req.query);

    const { rows, total } = await repo.listByTenant(ctx.tenantId, q.limit, q.offset, {
      ...(q.status !== undefined ? { status: q.status } : {}),
      ...(q.category !== undefined ? { category: q.category } : {}),
    });

    return reply.send({
      data: rows.map(repo.toView),
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total },
    });
  });

  // POST /v1/cdp/events/taxonomy — register a draft definition (CDP-004)
  app.post("/v1/cdp/events/taxonomy", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createBody.parse(req.body);

    const schemaError = validateSchemaDefinition(body.schemaJson);
    if (schemaError !== null) {
      throw new HttpError(400, "INVALID_SCHEMA", schemaError);
    }

    const clash = await repo.findByEventName(body.eventName, ctx.tenantId);
    if (clash) {
      throw new HttpError(409, "DUPLICATE_EVENT_NAME", `event "${body.eventName}" is already registered`);
    }

    const id = randomUUID();
    await db.transaction(async (tx) => {
      await repo.insert(tx, {
        id,
        tenantId: ctx.tenantId,
        eventName: body.eventName,
        category: body.category,
        schemaJson: body.schemaJson,
        // New definitions always start as drafts — registration is not approval.
        status: "draft",
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.taxonomyCreated,
        eventType: EVENTS.taxonomyCreated,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { taxonomyId: id, eventName: body.eventName, category: body.category },
      });

      await enqueue(tx, {
        topic: "audit.event.record",
        eventType: "audit.event.record",
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: {
          service: "cdp",
          action: "event_taxonomy_created",
          resourceType: "event_taxonomy",
          resourceId: id,
          outcome: "success",
          metadata: { eventName: body.eventName, category: body.category },
        },
      });
    });

    return reply.code(201).send({
      data: { id, eventName: body.eventName, category: body.category, status: "draft", version: 1 },
    });
  });

  // PATCH /v1/cdp/events/taxonomy/:id — amend a definition (CDP-004)
  app.patch("/v1/cdp/events/taxonomy/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateBody.parse(req.body);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "taxonomy definition not found");
    }

    if (body.schemaJson !== undefined) {
      const schemaError = validateSchemaDefinition(body.schemaJson);
      if (schemaError !== null) {
        throw new HttpError(400, "INVALID_SCHEMA", schemaError);
      }
    }

    if (body.status !== undefined && !canTransition(existing.status, body.status)) {
      throw new HttpError(422, "INVALID_TRANSITION", `cannot move ${existing.status} → ${body.status}`);
    }

    const patch: Partial<{ category: string; schemaJson: Record<string, unknown>; status: string; updatedBy: string }> = {
      updatedBy: ctx.actorId,
    };
    if (body.category !== undefined) patch.category = body.category;
    if (body.schemaJson !== undefined) patch.schemaJson = body.schemaJson;
    if (body.status !== undefined) patch.status = body.status;

    await db.transaction(async (tx) => {
      const ok = await repo.update(tx, id, ctx.tenantId, patch, body.version);
      if (!ok) {
        throw new HttpError(409, "VERSION_CONFLICT", "taxonomy definition has been modified; retry with current version");
      }

      await enqueue(tx, {
        topic: EVENTS.taxonomyUpdated,
        eventType: EVENTS.taxonomyUpdated,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { taxonomyId: id, eventName: existing.eventName, patch: { ...patch } },
      });

      await enqueue(tx, {
        topic: "audit.event.record",
        eventType: "audit.event.record",
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: {
          service: "cdp",
          action: "event_taxonomy_updated",
          resourceType: "event_taxonomy",
          resourceId: id,
          outcome: "success",
          metadata: { eventName: existing.eventName },
        },
      });
    });

    return reply.send({ data: { id, updated: true, version: body.version + 1 } });
  });

  // POST /v1/cdp/events/taxonomy/:id/approve — make a definition publishable (CDP-004)
  app.post("/v1/cdp/events/taxonomy/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPROVE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = approveBody.parse(req.body);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "taxonomy definition not found");
    }
    if (!canTransition(existing.status, "approved")) {
      throw new HttpError(422, "INVALID_TRANSITION", `cannot approve a ${existing.status} definition`);
    }

    await db.transaction(async (tx) => {
      const ok = await repo.update(
        tx,
        id,
        ctx.tenantId,
        { status: "approved", updatedBy: ctx.actorId },
        body.version,
      );
      if (!ok) {
        throw new HttpError(409, "VERSION_CONFLICT", "taxonomy definition has been modified; retry with current version");
      }

      await enqueue(tx, {
        topic: EVENTS.taxonomyApproved,
        eventType: EVENTS.taxonomyApproved,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { taxonomyId: id, eventName: existing.eventName },
      });

      await enqueue(tx, {
        topic: "audit.event.record",
        eventType: "audit.event.record",
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: {
          service: "cdp",
          action: "event_taxonomy_approved",
          resourceType: "event_taxonomy",
          resourceId: id,
          outcome: "success",
          metadata: { eventName: existing.eventName },
        },
      });
    });

    return reply.send({
      data: { id, eventName: existing.eventName, status: "approved", version: body.version + 1 },
    });
  });

  // POST /v1/cdp/events/validate — check a payload against its approved contract (CDP-004)
  app.post("/v1/cdp/events/validate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const body = validateBody.parse(req.body);

    const definition = await repo.findByEventName(body.eventName, ctx.tenantId);
    if (!definition) {
      // 422, not 404: the request itself is well formed, the event name is ungoverned.
      throw new HttpError(422, "UNKNOWN_EVENT_NAME", `event "${body.eventName}" is not in the taxonomy`);
    }
    if (definition.status !== "approved") {
      throw new HttpError(
        422,
        definition.status === "deprecated" ? "DEPRECATED_EVENT_NAME" : "UNAPPROVED_EVENT_NAME",
        `event "${body.eventName}" is ${definition.status}; only approved events may be ingested`,
      );
    }

    const result = validatePayload(body.payload, definition.schemaJson);
    if (!result.valid) {
      throw new HttpError(422, "PAYLOAD_SCHEMA_VIOLATION", `payload does not satisfy the taxonomy for "${body.eventName}"`);
    }

    return reply.send({
      data: {
        eventName: body.eventName,
        valid: true,
        category: definition.category,
        unknownFields: result.unknownFields,
      },
    });
  });
}
