/**
 * Admin CRUD for the LM-002 public lead-capture form registry.
 *
 * GET    /v1/crm/lead-capture-forms       — the tenant's forms (includes the form key)
 * POST   /v1/crm/lead-capture-forms       — register a form; the KEY is minted here
 * PATCH  /v1/crm/lead-capture-forms/:id   — amend policy (enabled, consent, origins, …)
 * DELETE /v1/crm/lead-capture-forms/:id   — remove the form so its public URL 404s
 *
 * Mutations are CQRS: validate → publish → 202. The writes live in
 * capture-forms-consumer.ts.
 *
 * ── Why ADMIN-only, not crm_user ────────────────────────────────────────────────
 * Unlike LM-001's field rules, which any CRM user may READ because the guided form needs
 * them, nothing here is readable by a plain user. Every row is a live credential for an
 * UNAUTHENTICATED write endpoint plus the policy that governs it (whose consent is
 * mandatory, which origins may post, how fast). A crm_user who could read the list could
 * hand the key to anyone; one who could PATCH it could set `requireConsent: false` and
 * turn a lawful form into an unlawful one, or widen `allowedOrigins` to a site they
 * control. That is governance, so it sits with the same roles that govern LM-001
 * mutations.
 *
 * ── Why the response includes the form key ──────────────────────────────────────
 * An admin cannot embed a form without it, and they are the principal it was minted for.
 * It is deliberately NOT on the emitted events (see EVENTS.leadCaptureFormCreated) and
 * never logged anywhere.
 */
import type { FastifyInstance } from "fastify";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  createCaptureFormBody,
  updateCaptureFormBody,
  captureFormIdParam,
} from "./capture-forms-validators.js";
import * as repo from "./capture-forms-repo.js";
import * as commands from "./capture-forms-commands.js";

/** Same set that governs LM-001 field rules — see the file header for why. */
const ADMIN_ROLES = ["crm_admin", "tenant_admin", "super_admin"];

export async function leadCaptureFormRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/crm/lead-capture-forms", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const forms = await repo.listForms(ctx.tenantId);
    // Configuration, not a dataset: a tenant has a handful of forms, so the whole set is
    // returned in one page rather than paginated. `meta` keeps the list envelope shape.
    return reply.send({
      data: forms,
      meta: { page: 1, pageSize: forms.length, total: forms.length },
    });
  });

  app.post("/v1/crm/lead-capture-forms", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createCaptureFormBody.parse(req.body);
    const accepted = await commands.createCaptureForm(ctx, body);
    // 202 with the key alongside the standard Accepted envelope. The key is minted at
    // publish time (not by the consumer) precisely so it can be returned here — the
    // admin would otherwise have to poll the list to discover the URL they just created.
    return sendAccepted(reply, acceptedResponseSchema.passthrough(), accepted);
  });

  app.patch("/v1/crm/lead-capture-forms/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = captureFormIdParam.parse(req.params);
    const body = updateCaptureFormBody.parse(req.body);

    // Tenant-scoped existence check, so another tenant's id is a 404 rather than a 202
    // for a command that would then match no row.
    const existing = await repo.findById(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "lead capture form not found");

    return sendAccepted(reply, acceptedResponseSchema, await commands.updateCaptureForm(ctx, id, body));
  });

  app.delete("/v1/crm/lead-capture-forms/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = captureFormIdParam.parse(req.params);

    const existing = await repo.findById(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "lead capture form not found");

    return sendAccepted(reply, acceptedResponseSchema, await commands.deleteCaptureForm(ctx, id));
  });
}
