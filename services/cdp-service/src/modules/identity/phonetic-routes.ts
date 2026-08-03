/**
 * identity/phonetic-routes.ts — CR-CDP-02 phonetic / approximate name matching.
 *
 * Two endpoints: one indexes a profile's name so it can be found, one searches. Scoring
 * is done by phonetic-domain.ts (pure) against a bounded candidate window returned by
 * name-key-repo.ts — see the note there on why the score is not computed in SQL.
 *
 * Index writes are queue-first (CQRS): the route validates and publishes; the F3 consumer
 * upserts via markProcessed.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { publishF3Write } from "../../shared/f3-publish.js";
import * as nameKeyRepo from "./name-key-repo.js";
import * as profilesRepo from "../profiles/repo.js";
import {
  normalizeName,
  phoneticKey,
  rankNameMatches,
  PHONETIC_MATCH_THRESHOLD,
  PHONETIC_REVIEW_THRESHOLD,
} from "./phonetic-domain.js";

const READ_ROLES = ["cdp_user", "cdp_steward", "cdp_admin", "super_admin", "tenant_admin"];
const WRITE_ROLES = ["cdp_user", "cdp_admin", "super_admin", "tenant_admin"];

/**
 * Upper bound on rows retrieved per search. Phonetic scoring is O(candidates); an
 * unbounded window would make search latency a function of tenant size.
 */
export const NAME_CANDIDATE_WINDOW = 200;

const indexBody = z.object({
  profileId: z.string().uuid(),
  name: z.string().min(1).max(200),
});

const matchBody = z.object({
  name: z.string().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(200).default(20),
});

export async function identityPhoneticRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/cdp/identity/name-keys — index a profile's name for matching (CR-CDP-02)
  app.post("/v1/cdp/identity/name-keys", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = indexBody.parse(req.body);

    const profile = await profilesRepo.findById(body.profileId, ctx.tenantId);
    if (!profile || profile.profileType === "merged") {
      throw new HttpError(404, "NOT_FOUND", "profile not found");
    }

    const nameNormalized = normalizeName(body.name);
    if (nameNormalized === "") {
      // Well-formed request, unusable name ("...", "12345", "Mr."). Indexing it would
      // create a key that matches nothing and pollutes every future candidate window.
      throw new HttpError(422, "UNINDEXABLE_NAME", "name contains no matchable characters");
    }

    const key = phoneticKey(body.name);
    const existing = await nameKeyRepo.findByProfile(body.profileId, ctx.tenantId);
    const id = existing?.id ?? randomUUID();

    await publishF3Write(ctx, "name_key_index", id, {
      profileId: body.profileId,
      nameNormalized,
      phoneticKey: key,
      reindexed: existing !== null,
    });

    return reply.code(202).send({
      data: {
        id,
        profileId: body.profileId,
        phoneticKey: key,
        reindexed: existing !== null,
        status: "accepted",
        correlationId: ctx.correlationId,
      },
    });
  });

  // POST /v1/cdp/identity/match-name — ranked approximate name matches (CR-CDP-02)
  app.post("/v1/cdp/identity/match-name", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const body = matchBody.parse(req.body);

    const nameNormalized = normalizeName(body.name);
    if (nameNormalized === "") {
      throw new HttpError(422, "UNMATCHABLE_NAME", "name contains no matchable characters");
    }

    const key = phoneticKey(body.name);
    const window = await nameKeyRepo.findCandidates(ctx.tenantId, key, nameNormalized, NAME_CANDIDATE_WINDOW);
    const candidates = rankNameMatches(body.name, window, body.limit);

    return reply.send({
      data: {
        phoneticKey: key,
        candidates,
        thresholds: { match: PHONETIC_MATCH_THRESHOLD, review: PHONETIC_REVIEW_THRESHOLD },
        candidateWindow: NAME_CANDIDATE_WINDOW,
      },
    });
  });
}
