/**
 * Onboarding health metric routes (G19).
 *
 * GET  /v1/crm/onboarding-health-rules          — list rules (paginated)
 * POST /v1/crm/onboarding-health-rules          — create rule (202)
 * PATCH /v1/crm/onboarding-health-rules/:id     — update rule (202)
 * GET  /v1/crm/onboarding-cases/:caseId/health  — read health score
 * POST /v1/crm/onboarding-cases/:caseId/health/recompute — trigger recompute (202)
 */
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { listQuery, windowOf, listEnvelope } from "../../shared/list-query.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import {
  createHealthRuleBody,
  updateHealthRuleBody,
  idParam,
  caseIdParam,
} from "./validators.js";

const CRM_ADMIN_ROLES = ["crm_admin", "super_admin", "tenant_admin"];
const CRM_READ_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];

export async function onboardingHealthRoutes(app: FastifyInstance): Promise<void> {
  // List health rules
  app.get("/v1/crm/onboarding-health-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_READ_ROLES);
    const q = listQuery.parse(req.query ?? {});
    const w = windowOf(q);
    const { rows, total } = await queries.listHealthRules(ctx.tenantId, w.pageSize, w.offset);
    return reply.send(listEnvelope(rows, w, total));
  });

  // Create health rule
  app.post("/v1/crm/onboarding-health-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ADMIN_ROLES);
    const body = createHealthRuleBody.parse(req.body);
    const id = randomUUID();
    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.createHealthRule(ctx, id, { ...body, id }),
    );
  });

  // Update health rule
  app.patch("/v1/crm/onboarding-health-rules/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateHealthRuleBody.parse(req.body);

    // Check rule exists
    const existing = await queries.getHealthRule(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "health rule not found");

    const { version, ...changed } = body;
    if (version !== existing.version) {
      throw new HttpError(409, "VERSION_CONFLICT", `rule is at version ${existing.version}, not ${version}`);
    }

    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.updateHealthRule(ctx, id, { changed, version }),
    );
  });

  // Read health score for a case
  app.get("/v1/crm/onboarding-cases/:caseId/health", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_READ_ROLES);
    const { caseId } = caseIdParam.parse(req.params);
    const score = await queries.getHealthScore(caseId, ctx.tenantId);
    if (!score) throw new HttpError(404, "NOT_FOUND", "health score not found for this case");
    return reply.send({ data: score });
  });

  // Trigger health recompute for a case
  app.post("/v1/crm/onboarding-cases/:caseId/health/recompute", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_READ_ROLES);
    const { caseId } = caseIdParam.parse(req.params);
    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.recomputeHealth(ctx, caseId),
    );
  });
}
