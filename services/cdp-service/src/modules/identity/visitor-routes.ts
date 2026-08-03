/**
 * identity/visitor-routes.ts — CR-CDP-04 anonymous → known visitor merge.
 *
 * Tracking creates a shell golden profile for a device/cookie id so pre-login events have
 * somewhere to live. Stitching moves that shell's events, identifiers and devices into the
 * known profile and records the join in lineage.
 *
 * All of it is written transactionally by the route, exactly as the other cdp writes are;
 * the outbox events are the downstream contract. Deterministic identity lookup reuses
 * `hashIdentifier` and `identity/repo.findByHash` — the same helpers POST /v1/cdp/resolve
 * uses — so a visitor cannot be stitched by a weaker rule than a normal resolution.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { publishF3Write } from "../../shared/f3-publish.js";
import { hashIdentifier } from "./domain.js";
import * as visitorRepo from "./visitor-repo.js";
import * as identityRepo from "./repo.js";
import * as deviceRepo from "./device-repo.js";
import * as nameKeyRepo from "./name-key-repo.js";
import * as profilesRepo from "../profiles/repo.js";
import * as eventsRepo from "../events/repo.js";
import {
  ANONYMOUS_PROFILE_TYPE,
  validateStitch,
  planStitch,
  resolveKnownProfile,
} from "./stitch-domain.js";

const READ_ROLES = ["cdp_user", "cdp_steward", "cdp_admin", "super_admin", "tenant_admin"];
const WRITE_ROLES = ["cdp_user", "cdp_admin", "super_admin", "tenant_admin"];

/** The identifier type a visitor key is filed under in the identity graph. */
const VISITOR_IDENTIFIER_TYPE = "visitorId";

const DEVICE_TYPES = ["ios", "android", "web", "kiosk", "unknown"] as const;

const idParam = z.object({ id: z.string().uuid() });

const trackBody = z.object({
  /**
   * The raw device/cookie id. Never stored: only its SHA-256 hash is. A minimum length
   * keeps a caller from registering a short guessable key that would collide between
   * unrelated visitors.
   */
  visitorKey: z.string().min(8).max(256),
  deviceType: z.enum(DEVICE_TYPES).default("unknown"),
  attributes: z.record(z.unknown()).default({}),
});

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(["anonymous", "merged"]).optional(),
});

const stitchBody = z.object({
  knownProfileId: z.string().uuid().optional(),
  identifiers: z.array(z.object({
    type: z.string().min(1).max(64),
    value: z.string().min(1).max(256),
  })).min(1).max(10).optional(),
  version: z.number().int().min(1),
}).refine(
  (b) => (b.knownProfileId !== undefined) !== (b.identifiers !== undefined),
  { message: "supply exactly one of knownProfileId or identifiers" },
);

export async function identityVisitorRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/cdp/identity/anonymous-visitors — track an anonymous visitor (CR-CDP-04)
  app.post("/v1/cdp/identity/anonymous-visitors", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = trackBody.parse(req.body);

    const visitorKeyHash = hashIdentifier(VISITOR_IDENTIFIER_TYPE, body.visitorKey);
    const existing = await visitorRepo.findByHash(visitorKeyHash, ctx.tenantId);
    const seenAt = new Date();

    // A returning visitor is a heartbeat, not a new registration: re-creating the shell
    // would orphan the events already filed against the first one.
    if (existing) {
      await publishF3Write(ctx, "visitor_touch", existing.id, {
        seenAt: seenAt.toISOString(),
        deviceType: body.deviceType,
      });

      return reply.code(202).send({
        data: {
          id: existing.id,
          anonymousProfileId: existing.anonymousProfileId,
          status: existing.status,
          created: false,
          lastSeenAt: seenAt.toISOString(),
          correlationId: ctx.correlationId,
        },
      });
    }

    const visitorId = randomUUID();
    const anonymousProfileId = randomUUID();

    await publishF3Write(ctx, "visitor_track", visitorId, {
      anonymousProfileId,
      visitorKeyHash,
      deviceType: body.deviceType,
      seenAt: seenAt.toISOString(),
      attributes: { ...body.attributes, anonymous: true },
      sourceLineage: [{
        source: "anonymous_visitor",
        sourceId: `visitor:${visitorKeyHash.slice(0, 12)}`,
        timestamp: seenAt.toISOString(),
      }],
    });

    return reply.code(202).send({
      data: {
        id: visitorId,
        anonymousProfileId,
        status: "anonymous",
        created: true,
        deviceType: body.deviceType,
        firstSeenAt: seenAt.toISOString(),
        correlationId: ctx.correlationId,
      },
    });
  });

  // GET /v1/cdp/identity/anonymous-visitors — visitor register (CR-CDP-04)
  app.get("/v1/cdp/identity/anonymous-visitors", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = listQuery.parse(req.query);

    const { rows, total } = await visitorRepo.listByTenant(ctx.tenantId, q.limit, q.offset, {
      ...(q.status !== undefined ? { status: q.status } : {}),
    });

    return reply.send({
      data: rows.map(visitorRepo.toView),
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total },
    });
  });

  // POST /v1/cdp/identity/anonymous-visitors/:id/stitch — merge into the known profile (CR-CDP-04)
  app.post("/v1/cdp/identity/anonymous-visitors/:id/stitch", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = stitchBody.parse(req.body);

    const visitor = await visitorRepo.findById(id, ctx.tenantId);
    if (!visitor) throw new HttpError(404, "NOT_FOUND", "anonymous visitor not found");

    // Resolve the known profile: either named outright, or found deterministically from
    // the identifiers the customer authenticated with.
    let knownProfileId: string;
    if (body.knownProfileId !== undefined) {
      knownProfileId = body.knownProfileId;
    } else {
      const matched: string[] = [];
      for (const ident of body.identifiers ?? []) {
        const edges = await identityRepo.findByHash(hashIdentifier(ident.type, ident.value), ctx.tenantId);
        for (const edge of edges) {
          if (edge.profileId !== visitor.anonymousProfileId) matched.push(edge.profileId);
        }
      }
      const resolution = resolveKnownProfile(matched);
      if (resolution.status === "none") {
        throw new HttpError(
          422,
          "NO_KNOWN_PROFILE",
          "no known profile matches the supplied identifiers; create one before stitching",
        );
      }
      if (resolution.status === "ambiguous") {
        throw new HttpError(
          422,
          "AMBIGUOUS_IDENTITY",
          "identifiers resolve to more than one known profile; route to the steward queue",
        );
      }
      knownProfileId = resolution.profileId;
    }

    const [anonymous, known] = await Promise.all([
      profilesRepo.findById(visitor.anonymousProfileId, ctx.tenantId),
      profilesRepo.findById(knownProfileId, ctx.tenantId),
    ]);
    if (!anonymous) throw new HttpError(404, "NOT_FOUND", "anonymous profile not found");
    if (!known) throw new HttpError(404, "NOT_FOUND", "known profile not found");

    const stitchError = validateStitch({ visitorStatus: visitor.status, anonymous, known });
    if (stitchError !== null) throw new HttpError(422, "STITCH_INVALID", stitchError);

    const mergedAt = new Date();
    const plan = planStitch(anonymous, known, visitor.visitorKeyHash, mergedAt);

    await publishF3Write(ctx, "visitor_stitch", visitor.id, {
      visitorId: visitor.id,
      anonymousProfileId: anonymous.id,
      knownProfileId: known.id,
      version: body.version,
      attributes: plan.attributes,
      sourceLineage: plan.sourceLineage,
      mergedFromIds: anonymous.mergedFromIds,
      lineageEntry: plan.lineageEntry,
      mergedAt: mergedAt.toISOString(),
    });

    return reply.code(202).send({
      data: {
        visitorId: visitor.id,
        anonymousProfileId: anonymous.id,
        knownProfileId: known.id,
        status: "accepted",
        correlationId: ctx.correlationId,
        version: body.version + 1,
        lineageEntry: plan.lineageEntry,
      },
    });
  });
}
