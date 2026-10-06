/**
 * F2-01 — Server-side audited contacts export (CSV).
 *
 * GET /v1/crm/contacts/export?purpose=…&<filters>
 *
 * Supersedes the previous JSON export that lived in contacts/routes.ts. The gap
 * found that the web sent no `purpose` and the server stored none, so a bulk PII
 * egress could not be attributed to a stated reason (DPDP accountability).
 *
 * This route:
 *   - accepts `purpose` (min 10) and records it in the bulk-export audit event;
 *   - respects the active list filters server-side (reusing the list query);
 *   - returns CSV directly (text/csv) so the web uses it, not a client Blob;
 *   - masks phone/email for callers outside the contact PII-read set.
 *
 * DECISION (recorded): the role posture is UNCHANGED from the prior export — any
 * CRM role may export, but non-PII-read roles receive masked phone/email (the
 * same masking the list already applies). Tightening to admin-only was considered
 * but the acceptance criteria for F2-01 only require purpose + filters + CSV, and
 * the existing masking already prevents a plain crm_user from egressing clear PII.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { rowsToCsv, exportFilename, type CsvColumn } from "../../shared/csv-export.js";
import { auditBulkExport } from "../../shared/export-audit.js";
import { CONTACT_PII_ROLES } from "../../shared/data-governance.js";
import * as queries from "./queries.js";
import type { ListFilters } from "./repo.js";
import type { ContactView } from "./schema.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin"];
const PII_READ_ROLES = CONTACT_PII_ROLES;

/** Hard ceiling on a single export. */
const EXPORT_CAP = 5000;

const exportQuery = z.object({
  purpose: z.string().trim().min(10).max(500),
  limit: z.coerce.number().int().min(1).max(EXPORT_CAP).default(EXPORT_CAP),
  search: z.string().max(200).optional(),
  leadStatus: z.string().max(64).optional(),
  ownerId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
  temperature: z.string().max(32).optional(),
  priority: z.string().max(32).optional(),
  segmentName: z.string().max(64).optional(),
  product: z.string().max(64).optional(),
  region: z.string().max(64).optional(),
  source: z.string().max(64).optional(),
  status: z.string().max(32).optional(),
});

const COLUMNS: CsvColumn<ContactView>[] = [
  { header: "Name", value: (r) => r.name },
  { header: "Email", value: (r) => r.email },
  { header: "Phone", value: (r) => r.phone },
  { header: "Company", value: (r) => r.company },
  { header: "Designation", value: (r) => r.designation },
  { header: "City", value: (r) => r.city },
  { header: "Country", value: (r) => r.country },
  { header: "Lead Status", value: (r) => r.leadStatus },
  { header: "Lead Source", value: (r) => r.leadSource },
  { header: "Temperature", value: (r) => r.temperature },
  { header: "Priority", value: (r) => r.priority },
  { header: "Segment", value: (r) => r.segment },
  { header: "Product", value: (r) => r.product },
  { header: "Region", value: (r) => r.region },
  { header: "Tags", value: (r) => (r.tags ?? []).join("; ") },
  { header: "Marketing Consent", value: (r) => (r.marketingConsent ? "yes" : "no") },
  { header: "Created Owner", value: (r) => r.ownerId },
];

export async function contactExportRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/crm/contacts/export", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = exportQuery.parse(req.query ?? {});

    const reveal = ctx.roles.some((r) => PII_READ_ROLES.includes(r));

    const filters: ListFilters = {
      ...(q.search ? { search: q.search } : {}),
      ...(q.leadStatus ? { leadStatus: q.leadStatus } : {}),
      ...(q.ownerId ? { ownerId: q.ownerId } : {}),
      ...(q.accountId ? { accountId: q.accountId } : {}),
      ...(q.temperature ? { temperature: q.temperature } : {}),
      ...(q.priority ? { priority: q.priority } : {}),
      ...(q.segmentName ? { segmentName: q.segmentName } : {}),
      ...(q.product ? { product: q.product } : {}),
      ...(q.region ? { region: q.region } : {}),
      ...(q.source ? { leadSource: q.source } : {}),
      ...(q.status ? { contactStatus: q.status } : {}),
    };

    const rows = await queries.exportContactsFiltered(ctx.tenantId, reveal, q.limit, filters);
    const csv = rowsToCsv(COLUMNS, rows);

    await auditBulkExport(ctx, {
      resourceType: "contact",
      action: "contacts_bulk_export",
      rowCount: rows.length,
      purpose: q.purpose,
      filters: Object.fromEntries(
        Object.entries({ ...filters, search: q.search ? true : undefined }).filter(([, v]) => v !== undefined),
      ),
      masked: !reveal,
    });

    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="${exportFilename("contacts")}"`);
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
