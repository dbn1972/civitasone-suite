/**
 * CAP-060 — integration observability / DLQ replay routes (admin-service).
 *
 * POST /v1/admin/integration-ops/dead-letters            record a dead letter
 * GET  /v1/admin/integration-ops/dead-letters            list (filter: status, topic)
 * GET  /v1/admin/integration-ops/dead-letters/:id        detail + action history
 * POST /v1/admin/integration-ops/dead-letters/:id/requeue  replay one
 * POST /v1/admin/integration-ops/dead-letters/:id/discard  discard one
 * POST /v1/admin/integration-ops/dead-letters/bulk-requeue replay many (ids[]/topic)
 *
 * Platform-level ops — super_admin / platform_admin only. Tenant-scoped by RLS.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireSuperAdmin, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { recordDeadLetter, requeueOne, discardOne, requeueBulk, ReplayError } from "./service.js";

const recordBody = z.object({
  topic: z.string().min(1).max(120),
  messageId: z.string().max(120).optional(),
  sourceService: z.string().max(64).optional(),
  correlationId: z.string().max(120).optional(),
  payload: z.unknown().optional(),
  error: z.string().max(4000).optional(),
});

const noteBody = z.object({ note: z.string().max(1000).optional() });

const bulkBody = z.object({
  ids: z.array(z.string().uuid()).max(500).optional(),
  topic: z.string().max(120).optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

function mapReplayError(err: unknown): never {
  if (err instanceof ReplayError) throw new HttpError(err.status, err.code, err.message);
  throw err;
}

export async function integrationOpsRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/admin/integration-ops/dead-letters", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const body = recordBody.parse(req.body);
    const row = await recordDeadLetter(ctx, body);
    return reply.code(201).send({ data: row });
  });

  app.get("/v1/admin/integration-ops/dead-letters", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const q = z
      .object({
        status: z.enum(["pending", "requeued", "discarded"]).optional(),
        topic: z.string().max(120).optional(),
        limit: z.coerce.number().int().min(1).max(500).default(200),
      })
      .parse(req.query);
    const rows = await repo.listDeadLetters(ctx.tenantId, { status: q.status, topic: q.topic }, q.limit);
    return reply.send({ data: rows, meta: { total: rows.length } });
  });

  app.get("/v1/admin/integration-ops/dead-letters/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const row = await repo.getDeadLetter(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "dead letter not found");
    const actions = await repo.listActions(ctx.tenantId, id);
    return reply.send({ data: row, actions });
  });

  app.post("/v1/admin/integration-ops/dead-letters/:id/requeue", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = noteBody.parse(req.body ?? {});
    try {
      const row = await requeueOne(ctx, id, body.note);
      return reply.send({ data: row });
    } catch (err) {
      mapReplayError(err);
    }
  });

  app.post("/v1/admin/integration-ops/dead-letters/:id/discard", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = noteBody.parse(req.body ?? {});
    try {
      const row = await discardOne(ctx, id, body.note);
      return reply.send({ data: row });
    } catch (err) {
      mapReplayError(err);
    }
  });

  app.post("/v1/admin/integration-ops/dead-letters/bulk-requeue", async (req, reply) => {
    const ctx = resolveContext(req);
    requireSuperAdmin(ctx);
    const body = bulkBody.parse(req.body ?? {});
    try {
      const result = await requeueBulk(ctx, body);
      return reply.send({ data: result, meta: { requeued: result.requeued.length, failed: result.failed.length } });
    } catch (err) {
      mapReplayError(err);
    }
  });
}
