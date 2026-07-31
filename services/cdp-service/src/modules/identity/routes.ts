import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as profilesRepo from "../profiles/repo.js";
import * as stewardRepo from "../steward/repo.js";
import {
  hashIdentifier,
  normalizeIdentifier,
  deterministicConfidence,
  AMBIGUITY_THRESHOLD,
  AUTO_MATCH_THRESHOLD,
} from "./domain.js";

const CDP_ROLES = ["cdp_user", "cdp_admin", "super_admin"];
const ADMIN_ROLES = ["cdp_admin", "super_admin"];

const resolveBody = z.object({
  identifiers: z.array(z.object({
    type: z.string().min(1).max(64),
    value: z.string().min(1).max(256),
  })).min(1).max(10),
  attributes: z.record(z.unknown()).optional(),
  createIfMissing: z.boolean().default(true),
});

const profileIdParam = z.object({ profileId: z.string().uuid() });
const idParam = z.object({ id: z.string().uuid() });

export async function identityRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/cdp/resolve — find or create a profile given identifiers
  app.post("/v1/cdp/resolve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CDP_ROLES);
    const body = resolveBody.parse(req.body);

    // Attempt deterministic match: exact hash lookup for each identifier
    const candidateProfileIds = new Map<string, number>(); // profileId → match count
    for (const ident of body.identifiers) {
      const hash = hashIdentifier(ident.type, ident.value);
      const matches = await repo.findByHash(hash, ctx.tenantId);
      for (const match of matches) {
        const count = candidateProfileIds.get(match.profileId) ?? 0;
        candidateProfileIds.set(match.profileId, count + 1);
      }
    }

    // Single match with high confidence → return it
    if (candidateProfileIds.size === 1) {
      const [[profileId, matchCount]] = [...candidateProfileIds.entries()] as [[string, number]];
      const confidence = deterministicConfidence(body.identifiers[0]!.type);
      return reply.send({
        data: { profileId, confidence, matched: true, status: "matched" },
      });
    }

    // Multiple matches → ambiguous → route to steward queue
    if (candidateProfileIds.size > 1) {
      const candidates = [...candidateProfileIds.entries()].map(([profileId, count]) => ({
        profileId,
        confidence: Math.min(0.6 + count * 0.1, 0.89), // Never auto-match when ambiguous
      }));

      // Create steward queue entries
      const sortedCandidates = candidates.sort((a, b) => b.confidence - a.confidence);
      if (sortedCandidates.length >= 2) {
        await db.transaction(async (tx) => {
          await stewardRepo.insert(tx, {
            tenantId: ctx.tenantId,
            sourceProfileId: sortedCandidates[0]!.profileId,
            targetProfileId: sortedCandidates[1]!.profileId,
            confidence: String(sortedCandidates[0]!.confidence),
            matchReason: `ambiguous match on ${body.identifiers.map((i) => i.type).join(", ")}`,
            status: "pending",
            createdBy: ctx.actorId,
            updatedBy: ctx.actorId,
          });
        });
      }

      return reply.send({
        data: { profileId: null, confidence: 0, matched: false, status: "ambiguous", candidates },
      });
    }

    // No match found → create new profile if requested
    if (body.createIfMissing) {
      const profileId = randomUUID();

      await db.transaction(async (tx) => {
        // Create new golden profile
        await profilesRepo.insert(tx, {
          id: profileId,
          tenantId: ctx.tenantId,
          profileType: "individual",
          attributes: body.attributes ?? {},
          sourceLineage: [{
            source: "identity_resolution",
            sourceId: ctx.correlationId,
            timestamp: new Date().toISOString(),
          }],
          createdBy: ctx.actorId,
          updatedBy: ctx.actorId,
        });

        // Link all identifiers to the new profile
        for (const ident of body.identifiers) {
          await repo.insert(tx, {
            tenantId: ctx.tenantId,
            profileId,
            identifierType: ident.type,
            identifierHash: hashIdentifier(ident.type, ident.value),
            confidence: String(deterministicConfidence(ident.type)),
            createdBy: ctx.actorId,
            updatedBy: ctx.actorId,
          });
        }

        await enqueue(tx, {
          topic: EVENTS.identityResolved,
          eventType: EVENTS.identityResolved,
          tenantId: ctx.tenantId,
          actorId: ctx.actorId,
          correlationId: ctx.correlationId,
          payload: { profileId, identifiers: body.identifiers, outcome: "created" },
        });
      });

      return reply.code(201).send({
        data: { profileId, confidence: 1.0, matched: false, status: "created" },
      });
    }

    return reply.send({
      data: { profileId: null, confidence: 0, matched: false, status: "not_found" },
    });
  });

  // GET /v1/cdp/identity/:profileId — list all linked identifiers for a profile
  app.get("/v1/cdp/identity/:profileId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CDP_ROLES);
    const { profileId } = profileIdParam.parse(req.params);

    const rows = await repo.findByProfileId(profileId, ctx.tenantId);
    return reply.send({ data: rows.map(repo.toView) });
  });

  // DELETE /v1/cdp/identity/:id — unlink an identifier (admin only)
  app.delete("/v1/cdp/identity/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);

    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) {
      throw new HttpError(404, "NOT_FOUND", "identity link not found");
    }

    await db.transaction(async (tx) => {
      const deleted = await repo.deleteById(tx, id, ctx.tenantId);
      if (!deleted) {
        throw new HttpError(404, "NOT_FOUND", "identity link not found");
      }

      await enqueue(tx, {
        topic: "audit.event.record",
        eventType: "audit.event.record",
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: {
          service: "cdp",
          action: "identity_unlinked",
          resourceType: "identity_graph",
          resourceId: id,
          outcome: "success",
          metadata: { profileId: existing.profileId, identifierType: existing.identifierType },
        },
      });
    });

    return reply.code(204).send();
  });
}
