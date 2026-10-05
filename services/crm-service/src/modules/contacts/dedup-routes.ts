/**
 * Dedup configuration + pre-save duplicate-check routes (DQ-001).
 *
 *   GET  /v1/crm/dedup-rules             — read the tenant's matching rules (admin)
 *   PUT  /v1/crm/dedup-rules             — upsert matching rules (admin)
 *   POST /v1/crm/contacts/duplicate-check — ranked potential duplicates for a
 *                                           candidate contact, BEFORE it is saved
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as dedupRepo from "./dedup-repo.js";
import { rankDuplicates } from "./dedup-domain.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin"];
const ADMIN_ROLES = ["crm_admin", "super_admin"];

const ruleSchema = z.object({
  field: z.enum(["email", "phone", "gstin", "pan", "name", "company"]),
  matchType: z.enum(["exact", "fuzzy"]),
  weight: z.number().int().min(0).max(100),
  threshold: z.number().int().min(0).max(100),
  enabled: z.boolean(),
});

const putRulesBody = z.object({
  // F3-03 empty-config guard: an empty list reaches the ROUTE (422
  // EMPTY_CONFIG_REJECTED unless ?confirmEmpty=true) rather than a generic 400.
  rules: z.array(ruleSchema).max(20),
  // GAP-CRM-DEDUP-RULES-02: optional list-level optimistic-concurrency token.
  // Also accepted via the If-Match header; the header takes precedence.
  version: z.string().min(1).optional(),
});

/** F3-03: `?confirmEmpty=true` must be explicit to accept an empty config PUT.
 * (z.coerce.boolean() would read the string "false" as true, so use an enum.) */
const confirmEmptyQuery = z.object({
  confirmEmpty: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

const duplicateCheckBody = z.object({  id: z.string().uuid().optional(),
  name: z.string().max(200).optional(),
  email: z.string().max(320).optional(),
  phone: z.string().max(32).optional(),
  company: z.string().max(200).optional(),
  gstin: z.string().max(15).optional(),
  pan: z.string().max(10).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export async function dedupRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/crm/dedup-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { rules, meta } = await dedupRepo.getRulesList(ctx.tenantId, ctx.actorId);
    // GAP-CRM-DEDUP-RULES-02: surface the list version as an ETag (for If-Match)
    // and in the body meta, plus who/when last changed it for the editor.
    void reply.header("ETag", meta.version);
    return reply.send({ data: rules, version: meta.version, meta });
  });

  app.put("/v1/crm/dedup-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = putRulesBody.parse(req.body);
    const { confirmEmpty } = confirmEmptyQuery.parse(req.query ?? {});
    // F3-03: refuse an accidental empty dedup-rules PUT unless the caller explicitly
    // confirmed clearing all (the web's DedupRulesEditor already has a "clear all"
    // confirmation that sets confirmEmpty=true). Fails loud over a silent no-op.
    if (body.rules.length === 0 && !confirmEmpty) {
      throw new HttpError(422, "EMPTY_CONFIG_REJECTED", "an empty dedup-rules list requires confirmEmpty=true");
    }
    // If-Match header takes precedence over a body version; strip optional
    // weak-ETag quoting so `"3"` and `3` compare equal.
    const headerMatch = req.headers["if-match"];
    const ifMatch = typeof headerMatch === "string" ? headerMatch.replace(/^W\//, "").replace(/^"|"$/g, "") : undefined;
    const expectedVersion = ifMatch ?? body.version;
    const { rules, meta } = await dedupRepo.upsertRules(
      ctx.tenantId,
      body.rules,
      ctx.actorId,
      ctx.correlationId,
      expectedVersion,
    );
    void reply.header("ETag", meta.version);
    return reply.send({ data: rules, version: meta.version, meta });
  });

  /**
   * Pre-save duplicate check (DQ-001 AC: "Potential duplicates are displayed
   * before save or import."). Runs the tenant's configured rules over active
   * contacts and returns ranked candidates.
   */
  app.post("/v1/crm/contacts/duplicate-check", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const body = duplicateCheckBody.parse(req.body);

    const rules = await dedupRepo.getRules(ctx.tenantId, ctx.actorId);
    const candidates = await dedupRepo.fetchCandidates(ctx.tenantId, 2000, body.id);
    const matches = rankDuplicates(
      {
        name: body.name ?? null,
        email: body.email ?? null,
        phone: body.phone ?? null,
        company: body.company ?? null,
        gstin: body.gstin ?? null,
        pan: body.pan ?? null,
      },
      candidates,
      rules,
      body.limit ?? 10,
    );

    return reply.send({ data: matches });
  });
}
