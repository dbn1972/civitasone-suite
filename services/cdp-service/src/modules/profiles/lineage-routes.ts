/**
 * profiles/lineage-routes.ts — CDP-001 golden-profile source lineage.
 *
 * Lineage answers "which system told us this, and when". It is append-only and read in
 * insertion order: a rewritten or re-sorted lineage would destroy the provenance trail
 * that a data-quality dispute is settled with.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { cache } from "../../shared/infra.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const CDP_ROLES = ["cdp_user", "cdp_admin", "super_admin", "tenant_admin"];
const WRITE_ROLES = ["cdp_admin", "super_admin", "tenant_admin"];

const idParam = z.object({ id: z.string().uuid() });

const lineageEntry = z.object({
  source: z.string().min(1).max(64),
  sourceId: z.string().min(1).max(200),
  timestamp: z.string().datetime().optional(),
});

const appendBody = z.object({
  entry: lineageEntry,
  version: z.number().int().min(1),
});

export async function profileLineageRoutes(app: FastifyInstance): Promise<void> {
  // GET /v1/cdp/profiles/:id/lineage — ordered lineage array (CDP-001)
  app.get("/v1/cdp/profiles/:id/lineage", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CDP_ROLES);
    const { id } = idParam.parse(req.params);

    const cacheKey = cache.makeKey(ctx.tenantId, "profile_lineage", id);
    const profile = await cache.getOrLoad(cacheKey, () => repo.findById(id, ctx.tenantId));
    if (!profile || profile.profileType === "merged") {
      throw new HttpError(404, "NOT_FOUND", "profile not found");
    }

    return reply.send({
      data: {
        profileId: id,
        lineage: profile.sourceLineage.map((e) => ({
          source: e.source,
          sourceId: e.sourceId,
          timestamp: e.timestamp,
        })),
      },
    });
  });

  // POST /v1/cdp/profiles/:id/lineage — append an entry (CDP-001)
  app.post("/v1/cdp/profiles/:id/lineage", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = appendBody.parse(req.body);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing || existing.profileType === "merged") {
      throw new HttpError(404, "NOT_FOUND", "profile not found");
    }

    const entry = {
      source: body.entry.source,
      sourceId: body.entry.sourceId,
      // The server stamps a missing timestamp: an ingest client's clock is not a
      // trustworthy provenance record.
      timestamp: body.entry.timestamp ?? new Date().toISOString(),
    };

    await db.transaction(async (tx) => {
      const ok = await repo.update(
        tx,
        id,
        ctx.tenantId,
        { sourceLineage: [...existing.sourceLineage, entry], updatedBy: ctx.actorId },
        body.version,
      );
      if (!ok) {
        throw new HttpError(409, "VERSION_CONFLICT", "profile has been modified; retry with current version");
      }

      await enqueue(tx, {
        topic: EVENTS.lineageAppended,
        eventType: EVENTS.lineageAppended,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { profileId: id, entry },
      });

      await enqueue(tx, {
        topic: "audit.event.record",
        eventType: "audit.event.record",
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: {
          service: "cdp",
          action: "profile_lineage_appended",
          resourceType: "profile",
          resourceId: id,
          outcome: "success",
          metadata: { source: entry.source },
        },
      });
    });

    // No command is published here. The append above IS the authoritative write, and
    // `cdp.profile.lineage_appended` (emitted through the outbox inside the same
    // transaction) is what downstream services need. A command carrying the identical
    // payload had no subscriber and implied processing that never happened.
    await cache.invalidate(cache.makeKey(ctx.tenantId, "profile_lineage", id));
    await cache.invalidate(cache.makeKey(ctx.tenantId, "profile", id));
    await cache.invalidate(cache.makeKey(ctx.tenantId, "profile_summary", id));

    return reply.code(202).send({
      data: { profileId: id, entry, version: body.version + 1, status: "accepted" },
    });
  });
}
