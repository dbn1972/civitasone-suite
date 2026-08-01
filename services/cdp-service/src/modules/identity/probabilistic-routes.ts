/**
 * identity/probabilistic-routes.ts — CDP-002 probabilistic resolution endpoint.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole } from "../../shared/context.js";
import * as profilesRepo from "../profiles/repo.js";
import {
  rankCandidates,
  toCandidateAttributes,
  MATCH_THRESHOLD,
  REVIEW_THRESHOLD,
  type CandidateAttributes,
} from "./probabilistic-domain.js";

const CDP_ROLES = ["cdp_user", "cdp_steward", "cdp_admin", "super_admin", "tenant_admin"];

/**
 * Upper bound on the candidate window scored per request. Probabilistic scoring is
 * O(candidates); an unbounded scan would make this endpoint's latency a function of
 * tenant size. A narrower blocking key (email domain, phone prefix) is the next
 * optimisation — see the note in the report.
 */
const CANDIDATE_WINDOW = 500;

const resolveBody = z.object({
  attributes: z.object({
    email: z.string().min(1).max(320).optional(),
    phone: z.string().min(1).max(32).optional(),
    name: z.string().min(1).max(200).optional(),
    city: z.string().min(1).max(120).optional(),
  }).refine(
    (a) => Object.values(a).some((v) => v !== undefined),
    { message: "at least one of email, phone, name, city is required" },
  ),
  limit: z.coerce.number().int().min(1).max(200).default(20),
});

export async function identityProbabilisticRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/cdp/identity/resolve-probabilistic — ranked candidates (CDP-002)
  app.post("/v1/cdp/identity/resolve-probabilistic", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CDP_ROLES);
    const body = resolveBody.parse(req.body);

    const attributes: CandidateAttributes = {
      ...(body.attributes.email !== undefined ? { email: body.attributes.email } : {}),
      ...(body.attributes.phone !== undefined ? { phone: body.attributes.phone } : {}),
      ...(body.attributes.name !== undefined ? { name: body.attributes.name } : {}),
      ...(body.attributes.city !== undefined ? { city: body.attributes.city } : {}),
    };

    const { rows } = await profilesRepo.listByTenant(ctx.tenantId, CANDIDATE_WINDOW, 0, {
      profileType: "individual",
    });

    const candidates = rankCandidates(
      attributes,
      rows.map((r) => ({ profileId: r.id, attributes: toCandidateAttributes(r.attributes) })),
      body.limit,
    );

    return reply.send({
      data: {
        candidates,
        thresholds: { match: MATCH_THRESHOLD, review: REVIEW_THRESHOLD },
        candidateWindow: CANDIDATE_WINDOW,
      },
    });
  });
}
