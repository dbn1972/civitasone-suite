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
import { resolveContext, requireRole } from "../../shared/context.js";
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
  rules: z.array(ruleSchema).min(1).max(20),
});

const duplicateCheckBody = z.object({
  id: z.string().uuid().optional(),
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
    const rules = await dedupRepo.getRules(ctx.tenantId, ctx.actorId);
    return reply.send({ data: rules });
  });

  app.put("/v1/crm/dedup-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = putRulesBody.parse(req.body);
    const rules = await dedupRepo.upsertRules(ctx.tenantId, body.rules, ctx.actorId);
    return reply.send({ data: rules });
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
