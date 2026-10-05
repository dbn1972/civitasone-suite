/**
 * GAP-CRM-VOICE-OF-CUSTOMER-FEEDBACK-05 — citizen feedback HTTP surface.
 *
 *   POST /v1/crm/citizen-feedback             — record a rating + optional comment (202, CQRS)
 *   GET  /v1/crm/citizen-feedback/summary     — ratings tile aggregate (average, count)
 *   GET  /v1/crm/citizen-feedback             — admin-only list incl. comment (PII)
 *
 * The comment is free text the citizen typed. It is stored but shown unmasked
 * ONLY to CRM admins (CRM_PII_READ_ROLES) — the summary tile exposes no text.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole } from "../../shared/context.js";
import { recordFeedbackBody } from "./feedback-validators.js";
import * as commands from "./feedback-commands.js";
import * as queries from "./feedback-queries.js";

// Any CRM user may record feedback (the form is operated by staff on behalf of a
// citizen, or by a logged-in citizen-facing agent). Reading the aggregate is just
// as broad; reading individual comments is admin-only.
const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];
// Mirrors apps/web CRM_PII_READ_ROLES — comment text is PII, admins only.
const CRM_PII_READ_ROLES = ["crm_admin", "super_admin", "tenant_admin"];

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function citizenFeedbackRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/crm/citizen-feedback", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const body = recordFeedbackBody.parse(req.body);
    const id = randomUUID();
    return sendAccepted(reply, acceptedResponseSchema, await commands.recordCitizenFeedback(ctx, id, body));
  });

  app.get("/v1/crm/citizen-feedback/summary", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const summary = await queries.getRatingsSummary(ctx.tenantId);
    return reply.send({ data: summary });
  });

  app.get("/v1/crm/citizen-feedback", async (req, reply) => {
    const ctx = resolveContext(req);
    // Comment text is PII — only CRM admins may read the individual entries.
    requireRole(ctx, CRM_PII_READ_ROLES);
    const q = listQuery.parse(req.query ?? {});
    const { rows, total } = await queries.listForAdmin(ctx.tenantId, q.limit, q.offset);
    return reply.send({ data: rows, meta: { total, limit: q.limit, offset: q.offset } });
  });
}
