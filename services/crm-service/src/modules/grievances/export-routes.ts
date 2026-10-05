/**
 * F2-03 — Server-side audited export for grievances.
 *
 * GET /v1/crm/grievances/export?purpose=…&<filters>
 *
 * Same pattern as F2-02 (service requests): admin roles only, honours the
 * register filters, returns CSV directly, masks citizen phone/email per the F1
 * contact-PII rules unless the caller holds a PII-read role, and emits a
 * bulk-export audit event with row count, filters and the stated purpose.
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
import { STATUS, PRIORITY } from "./grievances-domain.js";

const ADMIN_ROLES = ["crm_admin", "super_admin", "tenant_admin"];

const EXPORT_CAP = 10000;

const exportQuery = z.object({
  purpose: z.string().trim().min(10).max(500),
  status: z.enum(STATUS).optional(),
  priority: z.enum(PRIORITY).optional(),
  category: z.string().max(64).optional(),
  assignedTo: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
});

interface GrievanceExportRow {
  referenceNo: string;
  citizenName: string;
  citizenPhone: string | null;
  citizenEmail: string | null;
  category: string;
  subject: string;
  priority: string;
  status: string;
  assignedTo: string | null;
  dueAt: string | null;
  resolvedAt: string | null;
  createdAt: string | null;
}

function columns(reveal: boolean): CsvColumn<GrievanceExportRow>[] {
  const phone = (r: GrievanceExportRow): string | null => (reveal ? r.citizenPhone : maskPhone(r.citizenPhone));
  const email = (r: GrievanceExportRow): string | null => (reveal ? r.citizenEmail : maskEmail(r.citizenEmail));
  return [
    { header: "Reference", value: (r) => r.referenceNo },
    { header: "Citizen", value: (r) => r.citizenName },
    { header: "Phone", value: phone },
    { header: "Email", value: email },
    { header: "Category", value: (r) => r.category },
    { header: "Subject", value: (r) => r.subject },
    { header: "Priority", value: (r) => r.priority },
    { header: "Status", value: (r) => r.status },
    { header: "Assigned To", value: (r) => r.assignedTo },
    { header: "Due At", value: (r) => r.dueAt },
    { header: "Resolved At", value: (r) => r.resolvedAt },
    { header: "Created At", value: (r) => r.createdAt },
  ];
}

export async function grievanceExportRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/crm/grievances/export", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const q = exportQuery.parse(req.query ?? {});

    const reveal = ctx.roles.some((r) => CRM_PII_READ_ROLES.includes(r));

    const statusF   = q.status     ? sql`AND g.status      = ${q.status}`              : sql``;
    const priorityF = q.priority   ? sql`AND g.priority    = ${q.priority}`            : sql``;
    const categoryF = q.category   ? sql`AND g.category    = ${q.category}`            : sql``;
    const assignedF = q.assignedTo ? sql`AND g.assigned_to = ${q.assignedTo}::uuid`    : sql``;
    const searchF   = q.search
      ? sql`AND (g.citizen_name ILIKE ${"%" + q.search + "%"}
                 OR g.subject   ILIKE ${"%" + q.search + "%"}
                 OR g.reference_no ILIKE ${"%" + q.search + "%"})`
      : sql``;

    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT g.reference_no AS "referenceNo", g.citizen_name AS "citizenName",
             g.citizen_phone AS "citizenPhone", g.citizen_email AS "citizenEmail",
             g.category, g.subject, g.priority, g.status,
             g.assigned_to AS "assignedTo",
             g.due_at AS "dueAt", g.resolved_at AS "resolvedAt", g.created_at AS "createdAt"
      FROM crm.grievances g
      WHERE g.tenant_id = ${ctx.tenantId}
        ${statusF} ${priorityF} ${categoryF} ${assignedF} ${searchF}
      ORDER BY g.created_at DESC
      LIMIT ${EXPORT_CAP}
    `))) as unknown as GrievanceExportRow[];

    const csv = rowsToCsv(columns(reveal), rows);

    await auditBulkExport(ctx, {
      resourceType: "grievance",
      action: "grievances_bulk_export",
      rowCount: rows.length,
      purpose: q.purpose,
      filters: {
        ...(q.status ? { status: q.status } : {}),
        ...(q.priority ? { priority: q.priority } : {}),
        ...(q.category ? { category: q.category } : {}),
        ...(q.assignedTo ? { assignedTo: q.assignedTo } : {}),
        ...(q.search ? { search: true } : {}),
      },
      masked: !reveal,
    });

    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="${exportFilename("grievances")}"`);
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
