/**
 * F2-02 — Server-side audited export for service requests.
 *
 * GET /v1/crm/service-requests/export?purpose=…&<filters>
 *
 * Admin roles only. Honours the same filters as the register list, returns CSV
 * directly (text/csv) so the web uses this instead of a client-side DataTable
 * Blob, masks citizen phone/email per the F1 contact-PII rules unless the caller
 * holds a PII-read role, and emits a bulk-export audit event carrying the row
 * count, filters and the operator's stated purpose (never the PII values).
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { rowsToCsv, exportFilename, type CsvColumn } from "../../shared/csv-export.js";
import { auditBulkExport } from "../../shared/export-audit.js";
import { maskPhone, maskEmail } from "../../shared/pii-crypto.js";
import { CRM_PII_READ_ROLES } from "../../shared/pii-reveal.js";

const ADMIN_ROLES = ["crm_admin", "super_admin", "tenant_admin"];

const PRIORITY = ["low", "normal", "high", "urgent"] as const;
const STATUS = ["open", "in_progress", "pending", "resolved", "closed", "cancelled"] as const;

/** Hard ceiling on a single export so one request can never scan the whole register. */
const EXPORT_CAP = 10000;

const exportQuery = z.object({
  // DPDP accountability: a bulk PII egress must state why. Min 10 chars so it is
  // a real reason, not a keystroke.
  purpose: z.string().trim().min(10).max(500),
  status: z.enum(STATUS).optional(),
  priority: z.enum(PRIORITY).optional(),
  serviceType: z.string().max(64).optional(),
  assignedTo: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
});

interface SrExportRow {
  referenceNo: string;
  citizenName: string;
  citizenPhone: string | null;
  citizenEmail: string | null;
  serviceType: string;
  subject: string;
  priority: string;
  status: string;
  assignedTo: string | null;
  dueAt: string | null;
  resolvedAt: string | null;
  createdAt: string | null;
}

function columns(reveal: boolean): CsvColumn<SrExportRow>[] {
  const phone = (r: SrExportRow): string | null => (reveal ? r.citizenPhone : maskPhone(r.citizenPhone));
  const email = (r: SrExportRow): string | null => (reveal ? r.citizenEmail : maskEmail(r.citizenEmail));
  return [
    { header: "Reference", value: (r) => r.referenceNo },
    { header: "Citizen", value: (r) => r.citizenName },
    { header: "Phone", value: phone },
    { header: "Email", value: email },
    { header: "Service Type", value: (r) => r.serviceType },
    { header: "Subject", value: (r) => r.subject },
    { header: "Priority", value: (r) => r.priority },
    { header: "Status", value: (r) => r.status },
    { header: "Assigned To", value: (r) => r.assignedTo },
    { header: "Due At", value: (r) => r.dueAt },
    { header: "Resolved At", value: (r) => r.resolvedAt },
    { header: "Created At", value: (r) => r.createdAt },
  ];
}

export async function serviceRequestExportRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/crm/service-requests/export", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const q = exportQuery.parse(req.query ?? {});

    const reveal = ctx.roles.some((r) => CRM_PII_READ_ROLES.includes(r));

    const statusF   = q.status      ? sql`AND r.status       = ${q.status}`            : sql``;
    const priorityF = q.priority    ? sql`AND r.priority      = ${q.priority}`          : sql``;
    const typeF     = q.serviceType ? sql`AND r.service_type  = ${q.serviceType}`       : sql``;
    const assignedF = q.assignedTo  ? sql`AND r.assigned_to   = ${q.assignedTo}::uuid`  : sql``;
    const searchF   = q.search
      ? sql`AND (r.citizen_name ILIKE ${"%" + q.search + "%"}
                 OR r.subject    ILIKE ${"%" + q.search + "%"}
                 OR r.reference_no ILIKE ${"%" + q.search + "%"})`
      : sql``;

    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT r.reference_no AS "referenceNo", r.citizen_name AS "citizenName",
             r.citizen_phone AS "citizenPhone", r.citizen_email AS "citizenEmail",
             r.service_type AS "serviceType", r.subject, r.priority, r.status,
             r.assigned_to AS "assignedTo",
             r.due_at AS "dueAt", r.resolved_at AS "resolvedAt", r.created_at AS "createdAt"
      FROM crm.service_requests r
      WHERE r.tenant_id = ${ctx.tenantId}
        ${statusF} ${priorityF} ${typeF} ${assignedF} ${searchF}
      ORDER BY r.created_at DESC
      LIMIT ${EXPORT_CAP}
    `))) as unknown as SrExportRow[];

    const csv = rowsToCsv(columns(reveal), rows);

    await auditBulkExport(ctx, {
      resourceType: "service_request",
      action: "service_requests_bulk_export",
      rowCount: rows.length,
      purpose: q.purpose,
      filters: {
        ...(q.status ? { status: q.status } : {}),
        ...(q.priority ? { priority: q.priority } : {}),
        ...(q.serviceType ? { serviceType: q.serviceType } : {}),
        ...(q.assignedTo ? { assignedTo: q.assignedTo } : {}),
        ...(q.search ? { search: true } : {}),
      },
      masked: !reveal,
    });

    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="${exportFilename("service-requests")}"`);
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
