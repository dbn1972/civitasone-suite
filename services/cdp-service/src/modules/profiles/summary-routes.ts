/**
 * profiles/summary-routes.ts — CDP-008 Profile-as-a-Service compact read.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { cache } from "../../shared/infra.js";
import * as profilesRepo from "./repo.js";
import * as scoresRepo from "./scores-repo.js";
import * as deviceRepo from "../identity/device-repo.js";
import * as membershipRepo from "../segments/membership-repo.js";

const CDP_ROLES = ["cdp_user", "cdp_admin", "super_admin", "tenant_admin"];

const idParam = z.object({ id: z.string().uuid() });

/**
 * Attributes surfaced in the summary. The full attribute bag is deliberately not
 * returned: this endpoint is called inline by channel and journey services on every
 * personalisation decision, and an unbounded payload is what turns a 20ms read into a
 * 200ms one.
 */
const KEY_ATTRIBUTES = ["name", "email", "phone", "city", "state", "language", "preferredChannel"] as const;

export interface ProfileSummary {
  id: string;
  profileType: string;
  attributes: Record<string, unknown>;
  segmentCount: number;
  deviceCount: number;
  scoreCount: number;
  updatedAt: string;
}

/** Pure projection so the shape is testable without a database. */
export function projectSummary(
  profile: { id: string; profileType: string; attributes: Record<string, unknown>; updatedAt: Date },
  counts: { segmentCount: number; deviceCount: number; scoreCount: number },
): ProfileSummary {
  const attributes: Record<string, unknown> = {};
  for (const key of KEY_ATTRIBUTES) {
    const value = profile.attributes[key];
    if (value !== undefined && value !== null) attributes[key] = value;
  }
  return {
    id: profile.id,
    profileType: profile.profileType,
    attributes,
    segmentCount: counts.segmentCount,
    deviceCount: counts.deviceCount,
    scoreCount: counts.scoreCount,
    updatedAt: profile.updatedAt.toISOString(),
  };
}

export async function profileSummaryRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /v1/cdp/profiles/:id/summary — CDP-008, p95 ≤ 300ms.
   *
   * WHY cache-first: assembling this projection costs four round-trips (profile, segment
   * memberships, device tokens, scores), and two of them are COUNT queries over tables
   * that grow with tenant size. Served from Postgres the p95 tracks table growth and
   * blows the 300ms budget under load — this endpoint sits on the synchronous path of
   * every channel personalisation call, so its latency is a user-visible cost, not a
   * background one. The composed projection is cached under one key so a hit is a single
   * Redis GET; the write paths that can change any of the four inputs (profile update,
   * lineage append, device link, score upsert, segment recompute) all invalidate
   * `cdp:{tenant}:profile_summary:{id}`. `cache.getOrLoad` additionally coalesces
   * concurrent cold misses, so a burst on an uncached profile still costs one DB pass.
   *
   * Staleness bound: the cache TTL (CACHE_TTL, default 60s) is the worst case if an
   * invalidation is ever missed — acceptable for counts, and the reason the projection
   * carries counts rather than the authoritative lists.
   */
  app.get("/v1/cdp/profiles/:id/summary", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CDP_ROLES);
    const { id } = idParam.parse(req.params);

    const cacheKey = cache.makeKey(ctx.tenantId, "profile_summary", id);

    const summary = await cache.getOrLoad<ProfileSummary>(cacheKey, async () => {
      const profile = await profilesRepo.findById(id, ctx.tenantId);
      if (!profile || profile.profileType === "merged") return null;

      const [segmentCount, deviceCount, scoreCount] = await Promise.all([
        membershipRepo.countSegmentsForProfile(id, ctx.tenantId),
        deviceRepo.countByProfile(id, ctx.tenantId),
        scoresRepo.countByProfile(id, ctx.tenantId),
      ]);

      return projectSummary(profile, { segmentCount, deviceCount, scoreCount });
    });

    if (!summary) {
      throw new HttpError(404, "NOT_FOUND", "profile not found");
    }

    return reply.send({ data: summary });
  });
}
