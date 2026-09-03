import { randomUUID } from "node:crypto";
import { publishAdminCommand } from "../../shared/f3-publish.js";
import { COMMANDS } from "../../topics.js";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError, TENANT_ADMIN_ROLES } from "../../shared/context.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import type { ChangeRequestRow } from "./schema.js";
import {
  ChangeError,
  assertTransition,
  assertApproverDistinct,
  assertRollbackPlan,
  assertValidWindow,
  assertNoFreezeConflict,
  statusForPir,
  type ChangeStatus,
  type FreezeWindow,
} from "./domain.js";
import {
  idParam,
  listQuery,
  createChangeBody,
  rollbackPlanBody,
  approveBody,
  rejectBody,
  scheduleBody,
  completeBody,
  createFreezeBody,
} from "./validators.js";

const AUDIT_TOPIC = "audit.event.record";
// Cross-service release-notes / user-communication broadcast (→ notification-service).
const BROADCAST_TOPIC = "notification.broadcast.send";

// Change/release management is a platform + tenant admin governed process.
const CHANGE_ROLES = [...TENANT_ADMIN_ROLES];


function serialize(row: ChangeRequestRow): Record<string, unknown> {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    risk: row.risk,
    affectedServices: row.affectedServices,
    description: row.description,
    rollbackPlan: row.rollbackPlan,
    status: row.status,
    requestedBy: row.requestedBy,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    rejectedReason: row.rejectedReason,
    windowStart: row.windowStart?.toISOString() ?? null,
    windowEnd: row.windowEnd?.toISOString() ?? null,
    releaseNotes: row.releaseNotes,
    pirOutcome: row.pirOutcome,
    pirNotes: row.pirNotes,
    pirAt: row.pirAt?.toISOString() ?? null,
    createdAt: row.createdAt?.toISOString?.() ?? String(row.createdAt),
    updatedAt: row.updatedAt?.toISOString?.() ?? String(row.updatedAt),
    version: row.version,
  };
}

export async function changeRoutes(app: FastifyInstance): Promise<void> {
  // ── change requests ────────────────────────────────────────────────────────

  app.get("/v1/admin/change/requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CHANGE_ROLES);
    const q = listQuery.parse(req.query);
    const rows = await repo.listRequests(ctx.tenantId, q.limit);
    return reply.send({ data: rows.map(serialize) });
  });

  app.post("/v1/admin/change/requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CHANGE_ROLES);
    const body = createChangeBody.parse(req.body);
    const id = randomUUID();
    const __f3Id = randomUUID();
    await publishAdminCommand(ctx, COMMANDS.f3RouteWrite, __f3Id, {
      op: "change_op_0",
      body: (req.body as Record<string, unknown>),
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
      preId: ((req.params as any)?.id as string) || __f3Id,
    });
    return reply.code(202).send({ id: __f3Id, status: 'accepted', correlationId: ctx.correlationId, data: { id: __f3Id } });
  });

  app.get("/v1/admin/change/requests/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CHANGE_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await repo.findRequestById(id, ctx.tenantId);
    if (!row) throw new HttpError(404, "NOT_FOUND", "change request not found");
    const audit = await repo.listAudit(ctx.tenantId, id);
    return reply.send({
      data: serialize(row),
      audit: audit.map((a) => ({
        id: a.id,
        fromStatus: a.fromStatus,
        toStatus: a.toStatus,
        actorId: a.actorId,
        note: a.note,
        at: a.at?.toISOString?.() ?? String(a.at),
      })),
    });
  });

  app.post("/v1/admin/change/requests/:id/rollback-plan", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CHANGE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = rollbackPlanBody.parse(req.body);
    const __f3Id = randomUUID();
    await publishAdminCommand(ctx, COMMANDS.f3RouteWrite, __f3Id, {
      op: "change_op_1",
      body: (req.body as Record<string, unknown>),
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
      preId: ((req.params as any)?.id as string) || __f3Id,
    });
    return reply.send({ id, status: "ok" });
  });

  app.post("/v1/admin/change/requests/:id/submit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CHANGE_ROLES);
    const { id } = idParam.parse(req.params);
    const __f3Id = randomUUID();
    await publishAdminCommand(ctx, COMMANDS.f3RouteWrite, __f3Id, {
      op: "change_op_2",
      body: (req.body as Record<string, unknown>),
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
      preId: ((req.params as any)?.id as string) || __f3Id,
    });
    return reply.send({ id, status: "submitted" });
  });

  app.post("/v1/admin/change/requests/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CHANGE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = approveBody.parse(req.body ?? {});
    const __f3Id = randomUUID();
    await publishAdminCommand(ctx, COMMANDS.f3RouteWrite, __f3Id, {
      op: "change_op_3",
      body: (req.body as Record<string, unknown>),
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
      preId: ((req.params as any)?.id as string) || __f3Id,
    });
    return reply.send({ id, status: "approved" });
  });

  app.post("/v1/admin/change/requests/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CHANGE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = rejectBody.parse(req.body);
    const __f3Id = randomUUID();
    await publishAdminCommand(ctx, COMMANDS.f3RouteWrite, __f3Id, {
      op: "change_op_4",
      body: (req.body as Record<string, unknown>),
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
      preId: ((req.params as any)?.id as string) || __f3Id,
    });
    return reply.send({ id, status: "rejected" });
  });

  app.post("/v1/admin/change/requests/:id/schedule", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CHANGE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = scheduleBody.parse(req.body);
    const start = new Date(body.windowStart);
    const end = new Date(body.windowEnd);
    assertValidWindow(start, end);
    const __f3Id = randomUUID();
    await publishAdminCommand(ctx, COMMANDS.f3RouteWrite, __f3Id, {
      op: "change_op_5",
      body: (req.body as Record<string, unknown>),
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
      preId: ((req.params as any)?.id as string) || __f3Id,
    });
    return reply.send({ id, status: "scheduled" });
  });

  app.post("/v1/admin/change/requests/:id/start", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CHANGE_ROLES);
    const { id } = idParam.parse(req.params);
    const __f3Id = randomUUID();
    await publishAdminCommand(ctx, COMMANDS.f3RouteWrite, __f3Id, {
      op: "change_op_6",
      body: (req.body as Record<string, unknown>),
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
      preId: ((req.params as any)?.id as string) || __f3Id,
    });
    return reply.send({ id, status: "in_progress" });
  });

  // Post-implementation review + release-notes broadcast on a successful release.
  app.post("/v1/admin/change/requests/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CHANGE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = completeBody.parse(req.body);
    const target = statusForPir(body.outcome);
    const __f3Id = randomUUID();
    await publishAdminCommand(ctx, COMMANDS.f3RouteWrite, __f3Id, {
      op: "change_op_7",
      body: (req.body as Record<string, unknown>),
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
      preId: ((req.params as any)?.id as string) || __f3Id,
    });
    return reply.send({ id, status: target });
  });

  // ── freezes ──────────────────────────────────────────────────────────────────

  app.get("/v1/admin/change/freezes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CHANGE_ROLES);
    const rows = await repo.listFreezes(ctx.tenantId);
    return reply.send({
      data: rows.map((f) => ({
        id: f.id, name: f.name,
        startsAt: f.startsAt?.toISOString?.() ?? String(f.startsAt),
        endsAt: f.endsAt?.toISOString?.() ?? String(f.endsAt),
        reason: f.reason,
      })),
    });
  });

  app.post("/v1/admin/change/freezes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CHANGE_ROLES);
    const body = createFreezeBody.parse(req.body);
    const start = new Date(body.startsAt);
    const end = new Date(body.endsAt);
    assertValidWindow(start, end);
    const id = randomUUID();
    const __f3Id = randomUUID();
    await publishAdminCommand(ctx, COMMANDS.f3RouteWrite, __f3Id, {
      op: "change_op_8",
      body: (req.body as Record<string, unknown>),
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
      preId: ((req.params as any)?.id as string) || __f3Id,
    });
    return reply.code(202).send({ id: __f3Id, status: 'accepted', correlationId: ctx.correlationId, data: { id: __f3Id } });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    }
    if (err instanceof ChangeError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
