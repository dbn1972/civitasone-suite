/**
 * profiles/lineage-routes.ts — CDP-001 golden-profile source lineage.
 *
 * Lineage answers "which system told us this, and when". It is append-only and read in
 * insertion order: a rewritten or re-sorted lineage would destroy the provenance trail
 * that a data-quality dispute is settled with.
 *
 * Writes are queue-first (CQRS): the route validates and publishes; the F3 consumer
 * applies the append via markProcessed.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { publishF3Write } from "../../shared/f3-publish.js";
import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";

const CDP_ROLES = ["cdp_user", "cdp_admin", "super_admin", "tenant_admin"];
const WRITE_ROLES = ["cdp_admin", "super_admin", "tenant_admin"];

const idParam = z.object({ id: z.string().uuid() });

const lineageEntry = z.object({
  source: z.string().min(1).max(64),
  sourceId: z.string().min(1).max(200),
  timestamp: z.string().datetime().optional(),
  /**
   * Attribute keys this source supplied. Bounded because the trail is append-only:
   * an unbounded array on every ingest grows the profile row without limit.
   */
  attributes: z.array(z.string().min(1).max(64)).max(100).optional(),
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
      // Deduplicated so a caller repeating a key cannot inflate the trail; omitted
      // entirely when absent so an older entry stays byte-identical to before.
      ...(body.entry.attributes?.length
        ? { attributes: [...new Set(body.entry.attributes)] }
        : {}),
    };

    const sourceLineage = [...existing.sourceLineage, entry];

    await publishF3Write(ctx, "lineage_append", id, {
      profileId: id,
      version: body.version,
      entry,
      sourceLineage,
    });

    return reply.code(202).send({
      data: {
        profileId: id,
        entry,
        version: body.version + 1,
        status: "accepted",
        correlationId: ctx.correlationId,
      },
    });
  });
}
