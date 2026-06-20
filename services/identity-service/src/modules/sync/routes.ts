import type { FastifyInstance } from "fastify";
import {
  syncPushRequestSchema,
  syncPushResponseSchema,
  syncPullRequestSchema,
  syncPullResponseSchema,
} from "@civitasone/schemas/identity";
import { sendValidated } from "@civitasone/schemas/validate";
import { resolveContext } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import * as repo from "../devices/repo.js";

export async function syncRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/sync/push", async (req, reply) => {
    const ctx = resolveContext(req);
    const body = syncPushRequestSchema.parse(req.body);
    const applied: string[] = [];
    const conflicts: Array<{ clientMutationId: string; reason: string }> = [];
    let latestCursor = body.cursor;

    try {
      await db.transaction(async (tx) => {
        const results = await repo.appendChangelogBatch(
          tx,
          body.mutations.map((m) => ({
            tenantId: ctx.tenantId,
            mailbox: body.mailbox,
            entityId: m.entityId,
            operation: m.operation,
            payload: m.payload,
          })),
        );
        for (const m of body.mutations) applied.push(m.clientMutationId);
        if (results.length > 0) latestCursor = results[results.length - 1]!.seq;
      });
    } catch {
      for (const m of body.mutations) {
        conflicts.push({ clientMutationId: m.clientMutationId, reason: "server_rejected" });
      }
    }

    await repo.setCursor(ctx.tenantId, ctx.actorId, body.deviceId, body.mailbox, latestCursor);
    sendValidated(reply, syncPushResponseSchema, { mailbox: body.mailbox, cursor: latestCursor, applied, conflicts });
  });

  app.post("/v1/sync/pull", async (req, reply) => {
    const ctx = resolveContext(req);
    const body = syncPullRequestSchema.parse(req.body);
    const since = BigInt(body.cursor || "0");
    const rows = await repo.pullSince(ctx.tenantId, body.mailbox, since, body.limit);
    const entities = rows.map((r) => ({
      id: r.entityId,
      operation: r.operation === "delete" ? "delete" as const : "upsert" as const,
      data: r.payload ?? undefined,
      updatedAt: r.createdAt.toISOString(),
      etag: r.etag,
    }));
    const nextCursor = rows.length > 0 ? String(rows[rows.length - 1]!.seq) : body.cursor;
    if (rows.length > 0) {
      await repo.setCursor(ctx.tenantId, ctx.actorId, body.deviceId, body.mailbox, nextCursor);
    }
    sendValidated(reply, syncPullResponseSchema, {
      mailbox: body.mailbox,
      cursor: nextCursor,
      hasMore: rows.length >= body.limit,
      entities,
    });
  });
}
