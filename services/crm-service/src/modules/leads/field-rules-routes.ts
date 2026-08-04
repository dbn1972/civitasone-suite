/**
 * Configurable lead field rules (LM-001).
 * GET    /v1/crm/lead-field-rules            — the tenant's configuration
 * PUT    /v1/crm/lead-field-rules            — declare a field mandatory / weighted
 * DELETE /v1/crm/lead-field-rules/:fieldName — revert a field to built-in behaviour
 *
 * Mutations are CQRS: validate → publish → 202; the write lives in
 * field-rules-consumer.ts. PUT rather than POST because the rule is identified by
 * (tenant, fieldName), so re-declaring it is an update of the same resource, not a
 * second rule.
 */
import type { FastifyInstance } from "fastify";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { upsertLeadFieldRuleBody, leadFieldNameParam } from "./field-rules-validators.js";
import * as repo from "./field-rules-repo.js";
import * as commands from "./field-rules-commands.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin"];
/** Who governs mandatory fields — this decides whether other users can save a lead. */
const ADMIN_ROLES = ["crm_admin", "tenant_admin", "super_admin"];

export async function leadFieldRuleRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/crm/lead-field-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    // Readable by any CRM user: the guided form has to know which fields to star.
    const rules = await repo.listRules(ctx.tenantId);
    return reply.send({
      data: rules,
      meta: { page: 1, pageSize: rules.length, total: rules.length },
    });
  });

  app.put("/v1/crm/lead-field-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = upsertLeadFieldRuleBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.upsertLeadFieldRule(ctx, body));
  });

  app.delete("/v1/crm/lead-field-rules/:fieldName", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { fieldName } = leadFieldNameParam.parse(req.params);

    const existing = await repo.findByFieldName(ctx.tenantId, fieldName);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "lead field rule not found");

    return sendAccepted(reply, acceptedResponseSchema, await commands.deleteLeadFieldRule(ctx, fieldName));
  });
}
