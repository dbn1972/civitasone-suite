import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import {
  hashIdentifier,
  deterministicConfidence,
} from "./domain.js";
import * as commands from "./commands.js";

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
  app.post("/v1/cdp/resolve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CDP_ROLES);
    const body = resolveBody.parse(req.body);

    // PERF-005: was one repo.findByHash() call per submitted identifier
    // (N+1, N<=10). Batch-fetch every distinct hash's matches in a single
    // query, then replay the same per-identifier counting loop against the
    // in-memory result instead of re-querying -- this preserves the
    // original's exact semantics for a duplicate submitted identifier
    // (each occurrence still counts its hash's matches again), which a
    // naive de-duplicated batch would not.
    const hashes = body.identifiers.map((ident) => hashIdentifier(ident.type, ident.value));
    const matchesByHash = await repo.findByHashes(hashes, ctx.tenantId);
    const candidateProfileIds = new Map<string, number>();
    for (const hash of hashes) {
      const matches = matchesByHash.get(hash) ?? [];
      for (const match of matches) {
        const count = candidateProfileIds.get(match.profileId) ?? 0;
        candidateProfileIds.set(match.profileId, count + 1);
      }
    }

    if (candidateProfileIds.size === 1) {
      const [[profileId]] = [...candidateProfileIds.entries()] as [[string, number]];
      const confidence = deterministicConfidence(body.identifiers[0]!.type);
      return reply.send({
        data: { profileId, confidence, matched: true, status: "matched" },
      });
    }

    if (candidateProfileIds.size > 1) {
      const candidates = [...candidateProfileIds.entries()].map(([profileId, count]) => ({
        profileId,
        confidence: Math.min(0.6 + count * 0.1, 0.89),
      }));
      const sortedCandidates = candidates.sort((a, b) => b.confidence - a.confidence);
      if (sortedCandidates.length >= 2) {
        await commands.resolveAmbiguous(ctx, {
          sourceProfileId: sortedCandidates[0]!.profileId,
          targetProfileId: sortedCandidates[1]!.profileId,
          confidence: String(sortedCandidates[0]!.confidence),
          matchReason: `ambiguous match on ${body.identifiers.map((i) => i.type).join(", ")}`,
        });
      }
      return reply.code(202).send({
        data: { profileId: null, confidence: 0, matched: false, status: "ambiguous", candidates },
      });
    }

    if (body.createIfMissing) {
      return reply.code(202).send(
        await commands.resolveCreate(ctx, {
          identifiers: body.identifiers,
          attributes: body.attributes ?? {},
        }),
      );
    }

    return reply.send({
      data: { profileId: null, confidence: 0, matched: false, status: "not_found" },
    });
  });

  app.get("/v1/cdp/identity/:profileId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CDP_ROLES);
    const { profileId } = profileIdParam.parse(req.params);
    const rows = await repo.findByProfileId(profileId, ctx.tenantId);
    return reply.send({ data: rows.map(repo.toView) });
  });

  app.delete("/v1/cdp/identity/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "identity link not found");
    return reply.code(202).send(await commands.unlinkIdentity(ctx, id));
  });
}
