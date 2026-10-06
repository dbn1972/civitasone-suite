/**
 * F2-05 — Server-side audited export for the public lead-capture form registry.
 *
 * GET /v1/crm/lead-capture-forms/export?purpose=…
 *
 * Replaces the web's client-side confirm-only export with a server-audited one,
 * matching the F2 pattern: admin roles only (the same set that governs the form
 * registry), CSV returned directly, and a bulk-export audit event with the row
 * count and the operator's stated purpose.
 *
 * DECISION (conservative default, recorded): the form KEY is deliberately OMITTED
 * from the CSV. The key is the sole credential on an unauthenticated write
 * endpoint (see capture-forms-repo.generateFormKey); a spreadsheet is exactly the
 * kind of artefact that leaks, so a bulk export must not scatter live credentials.
 * An admin who needs a key reads it from the registry list, which already returns
 * it to the principal it was minted for.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { rowsToCsv, exportFilename, type CsvColumn } from "../../shared/csv-export.js";
import { auditBulkExport } from "../../shared/export-audit.js";
import * as repo from "./capture-forms-repo.js";
import type { LeadCaptureFormView } from "./capture-forms-schema.js";

/** Same admin set that governs the LM-002 form registry (see capture-forms-routes). */
const ADMIN_ROLES = ["crm_admin", "tenant_admin", "super_admin"];

const exportQuery = z.object({
  purpose: z.string().trim().min(10).max(500),
});

const COLUMNS: CsvColumn<LeadCaptureFormView>[] = [
  { header: "Name", value: (r) => r.name },
  { header: "Enabled", value: (r) => (r.enabled ? "yes" : "no") },
  { header: "Requires Consent", value: (r) => (r.requireConsent ? "yes" : "no") },
  { header: "Allowed Origins", value: (r) => (r.allowedOrigins ?? []).join("; ") },
  { header: "Default Lead Source", value: (r) => r.defaultLeadSource },
  { header: "Campaign Id", value: (r) => r.campaignId },
  { header: "Max Per Minute", value: (r) => r.maxPerMinute },
  { header: "Created At", value: (r) => r.createdAt },
  { header: "Updated At", value: (r) => r.updatedAt },
];

export async function leadCaptureFormExportRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/crm/lead-capture-forms/export", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const q = exportQuery.parse(req.query ?? {});

    const forms = await repo.listForms(ctx.tenantId);
    const csv = rowsToCsv(COLUMNS, forms);

    await auditBulkExport(ctx, {
      resourceType: "lead_capture_form",
      action: "lead_capture_forms_bulk_export",
      rowCount: forms.length,
      purpose: q.purpose,
    });

    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="${exportFilename("lead-capture-forms")}"`);
    return reply.send(csv);
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
