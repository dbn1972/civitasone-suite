import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { validateSyncBatch, type SyncOperation } from "./domain.js";

const FIELD_ROLES = ["field_admin", "field_agent", "super_admin"];

const syncPushBody = z.object({
  operations: z.array(z.object({
    id: z.string().uuid().default(() => randomUUID()),
    entityType: z.string().min(1).max(32),
    entityId: z.string().uuid(),
    operation: z.enum(["create", "update", "delete"]),
    payload: z.record(z.unknown()),
    clientTimestamp: z.string().datetime(),
    clientVersion: z.number().int().min(0).default(1),
  })).min(1).max(500),
});

const syncPullQuery = z.object({
  since: z.string(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export async function syncRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/field/sync/push — batch upload offline operations
  app.post("/v1/field/sync/push", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIELD_ROLES);
    const body = syncPushBody.parse(req.body);

    const operations: SyncOperation[] = body.operations.map((op) => ({
      id: op.id,
      entityType: op.entityType,
      entityId: op.entityId,
      operation: op.operation,
      payload: op.payload,
      clientTimestamp: op.clientTimestamp,
      clientVersion: op.clientVersion,
    }));

    // Validate batch
    const validationError = validateSyncBatch(operations);
    if (validationError) {
      throw new HttpError(422, "INVALID_BATCH", validationError);
    }

    // Persist to sync queue
    await db.transaction(async (tx) => {
      const rows = operations.map((op) => ({
        id: op.id,
        tenantId: ctx.tenantId,
        agentId: ctx.actorId,
        entityType: op.entityType,
        entityId: op.entityId,
        operation: op.operation,
        payload: op.payload,
        clientTimestamp: new Date(op.clientTimestamp),
        clientVersion: op.clientVersion,
        status: "pending" as const,
      }));

      await repo.insertBatch(tx, rows);

      await enqueue(tx, {
        topic: EVENTS.syncCompleted,
        eventType: EVENTS.syncCompleted,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { operationCount: operations.length, agentId: ctx.actorId },
      });
    });

    return reply.code(202).send({
      data: { processed: operations.length, syncedAt: new Date().toISOString() },
    });
  });

  // GET /v1/field/sync/pull — pull server changes since timestamp
  app.get("/v1/field/sync/pull", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FIELD_ROLES);
    const q = syncPullQuery.parse(req.query);

    const { rows, total } = await repo.getChangesSince(ctx.tenantId, ctx.actorId, q.since, q.limit);

    return reply.send({
      data: rows.map(repo.toView),
      meta: { total, since: q.since, limit: q.limit },
    });
  });
}
