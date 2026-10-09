import type { FastifyInstance, RouteHandlerMethod } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import * as repo from "./repo.js";
import { isUnitInactive } from "./state.js";

const ADMIN = ["super_admin", "platform_admin", "tenant_admin"];
const UNIT_TYPES = ["department", "division", "section", "unit", "branch"] as const;

export async function orgHierarchyRoutes(app: FastifyInstance): Promise<void> {
  // Real DB read — returns actual org units from PostgreSQL (RLS-scoped).
  // GAP2-TENANT-WIRING-01: the web org-hierarchy loader calls
  // /api/v1/tenant/org/hierarchy; the gateway `tenant-singular` prefix forwards
  // that verbatim as /v1/tenant/org/hierarchy. Register the alias so the loader
  // resolves (200) instead of a permanent 404 — mirrors the usage/plans aliases.
  const listHierarchy: RouteHandlerMethod = async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const units = await repo.listOrgUnits(ctx.tenantId);
    return reply.send({ data: units, meta: { total: units.length } });
  };
  app.get("/v1/org/hierarchy", listHierarchy);
  app.get("/v1/tenant/org/hierarchy", listHierarchy);

  // Single unit with its direct children.
  app.get("/v1/org/hierarchy/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const unit = await repo.findById(ctx.tenantId, id);
    if (!unit) throw new HttpError(404, "NOT_FOUND", "Org unit not found");
    const children = await repo.findChildren(ctx.tenantId, id);
    return reply.send({ data: { ...unit, children } });
  });

  // Subtree via a single recursive CTE (real hierarchy read).
  app.get("/v1/org/hierarchy/:id/subtree", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const root = await repo.findById(ctx.tenantId, id);
    if (!root) throw new HttpError(404, "NOT_FOUND", "Org unit not found");
    const tree = await repo.getSubtree(ctx.tenantId, id);
    return reply.send({ data: tree, meta: { total: tree.length } });
  });

  // CQRS write — publish create command (consumer persists).
  app.post("/v1/org/hierarchy", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const body = z.object({
      name: z.string().min(1).max(200),
      type: z.enum(UNIT_TYPES),
      parentId: z.string().uuid().optional(),
      headUserId: z.string().uuid().optional(),
      code: z.string().max(32).optional(),
    }).parse(req.body);
    // Fail fast if the referenced parent does not exist within the tenant.
    if (body.parentId) {
      const parent = await repo.findById(ctx.tenantId, body.parentId);
      if (!parent) throw new HttpError(404, "PARENT_NOT_FOUND", "parent org unit not found");
      if (isUnitInactive(parent)) throw new HttpError(409, "PARENT_INACTIVE", "parent org unit is deactivated");
    }
    const id = randomUUID();
    await queue.publish("tenant.org_unit.create", { messageId: id, type: "tenant.org_unit.create", tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { id, tenantId: ctx.tenantId, ...body } });
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });

  // Update / reparent — synchronous cycle + parent-existence validation.
  app.patch("/v1/org/hierarchy/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      name: z.string().min(1).max(200).optional(),
      type: z.enum(UNIT_TYPES).optional(),
      parentId: z.string().uuid().nullable().optional(),
      headUserId: z.string().uuid().nullable().optional(),
      code: z.string().max(32).nullable().optional(),
    }).parse(req.body);
    const existing = await repo.findById(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "Org unit not found");
    // GAP-ADMIN-ORG-03: a deactivated unit is history. No rename, head change, retype or move.
    if (isUnitInactive(existing)) throw new HttpError(409, "UNIT_INACTIVE", "Org unit is deactivated and can no longer be changed");

    if (body.parentId) {
      const parent = await repo.findById(ctx.tenantId, body.parentId);
      if (!parent) throw new HttpError(404, "PARENT_NOT_FOUND", "parent org unit not found");
      if (isUnitInactive(parent)) throw new HttpError(409, "PARENT_INACTIVE", "parent org unit is deactivated");
      if (await repo.wouldCreateCycle(ctx.tenantId, id, body.parentId)) {
        throw new HttpError(409, "HIERARCHY_CYCLE", "reparenting would create a cycle");
      }
    }

    await queue.publish("tenant.org_unit.update", { messageId: randomUUID(), type: "tenant.org_unit.update", tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { id, tenantId: ctx.tenantId, ...body } });
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });

  // GAP-ADMIN-ORG-03: deactivate (end-date) a unit. Never a delete: history and audit keep the row.
  // Refused while the unit still has an in-force child -- the operator moves or deactivates those first.
  app.post("/v1/org/hierarchy/:id/deactivate", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { reason, acknowledgePositions } = z.object({
      reason: z.string().trim().min(3).max(500),
      // Deliberate override: deactivate although active positions sit in this unit.
      acknowledgePositions: z.boolean().optional(),
    }).parse(req.body);
    const existing = await repo.findById(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "Org unit not found");
    if (isUnitInactive(existing)) throw new HttpError(409, "ALREADY_INACTIVE", "Org unit is already deactivated");
    const children = await repo.countActiveChildren(ctx.tenantId, id);
    if (children > 0) {
      throw new HttpError(409, "HAS_ACTIVE_CHILDREN", `Org unit has ${children} active child unit${children === 1 ? "" : "s"}; move or deactivate them first`);
    }
    // Safer default: positions would be left pointing at an inactive unit, so refuse until the caller says it is deliberate.
    const positions = await repo.countActivePositions(ctx.tenantId, id);
    if (positions > 0 && acknowledgePositions !== true) {
      throw new HttpError(409, "HAS_ACTIVE_POSITIONS", `Org unit has ${positions} open position${positions === 1 ? "" : "s"}; move or abolish them, or confirm that they stay in a deactivated unit`);
    }
    await queue.publish("tenant.org_unit.deactivate", { messageId: randomUUID(), type: "tenant.org_unit.deactivate", tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { id, tenantId: ctx.tenantId, reason, positionsAcknowledged: positions > 0 } });
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });

  // ── Bulk master-data (CAP-020) — see data-migration consumer for persistence ──
  app.post("/v1/org/master-data/import", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const body = z.object({ entityType: z.string().min(1), records: z.array(z.record(z.unknown())).min(1).max(5000) }).parse(req.body);
    const batchId = randomUUID();
    await queue.publish("tenant.master_data.import", { messageId: batchId, type: "tenant.master_data.import", tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { batchId, tenantId: ctx.tenantId, entityType: body.entityType, recordCount: body.records.length, records: body.records } });
    return reply.code(202).send({ data: { batchId, status: "queued", recordCount: body.records.length } });
  });

  app.post("/v1/org/master-data/export", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ADMIN);
    const body = z.object({ entityType: z.string().min(1), format: z.enum(["csv", "json"]).default("json") }).parse(req.body);
    const exportId = randomUUID();
    await queue.publish("tenant.master_data.export", { messageId: exportId, type: "tenant.master_data.export", tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { exportId, tenantId: ctx.tenantId, entityType: body.entityType, format: body.format } });
    return reply.code(202).send({ data: { exportId, status: "generating", format: body.format } });
  });

  app.setErrorHandler((err, req, reply) => {
    const cid = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId: cid });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId: cid });
    req.log.error({ err }, "unhandled"); return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId: cid });
  });
}
