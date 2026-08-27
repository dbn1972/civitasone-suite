import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { validateSyncBatch, type SyncOperation } from "./domain.js";
import * as commands from "./commands.js";

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

    const validationError = validateSyncBatch(operations);
    if (validationError) {
      throw new HttpError(422, "INVALID_BATCH", validationError);
    }

    const accepted = await commands.pushSync(ctx, operations);

    // Honest async-state note: this only confirms the batch was ACCEPTED onto the
    // queue (status: "accepted" above, from publishCommand) -- it does not mean the
    // operations were applied to their target task/visit/route records.
    // registerSyncConsumers currently inserts each op as a syncQueue row with
    // status "pending" and nothing ever transitions it to "processed" (no
    // consumer/cron anywhere calls repo.markProcessed/markFailed), so this
    // response must not claim "processed" or give a completion timestamp -- a
    // field worker's offline app could reasonably treat that as confirmation and
    // discard its local retry queue for data that was never actually applied.
    // Flagged separately: the server-side replay step (apply a pending operation's
    // payload to its real entity) was never implemented, and GET
    // /v1/field/sync/pull only ever returns status="processed" rows, so pushed
    // operations currently never surface anywhere once accepted.
    return reply.code(202).send({
      ...accepted,
      data: { accepted: operations.length, acceptedAt: new Date().toISOString() },
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
