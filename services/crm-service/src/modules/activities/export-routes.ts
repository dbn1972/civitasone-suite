/**
 * F2-04 — Server-side audited export for activities (deferred in LOW).
 *
 * GET /v1/crm/activities/export?purpose=…&<filters>
 *
 * CRM admin roles only (an activities export is a tenant-wide read, unlike the
 * per-subject timeline list, so it is restricted beyond the plain crm_user that
 * may read a single record's timeline). Returns CSV directly and emits a
 * bulk-export audit event with row count, filters and the stated purpose.
 *
 * Activities carry no citizen PII (actorName is a staff member and `text` is the
 * logged interaction), so there is no field masking here — but the export is
 * still audited because it is a bulk egress of the tenant's interaction history.
 * Optional subject/type/status filters mirror the fields the list can scope on.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { rowsToCsv, exportFilename, type CsvColumn } from "../../shared/csv-export.js";
import { auditBulkExport } from "../../shared/export-audit.js";

const ADMIN_ROLES = ["crm_admin", "super_admin", "tenant_admin"];

const EXPORT_CAP = 10000;

const SUBJECT_TYPES = ["contact", "deal", "account"] as const;

const exportQuery = z.object({
  purpose: z.string().trim().min(10).max(500),
  subjectType: z.enum(SUBJECT_TYPES).optional(),
  subjectId: z.string().uuid().optional(),
  type: z.string().max(16).optional(),
  status: z.string().max(24).optional(),
});

interface ActivityExportRow {
  createdAt: string | null;
  type: string;
  status: string;
  actorName: string;
  subject: string | null;
  text: string;
  subjectType: string | null;
  subjectId: string | null;
  dueDate: string | null;
  completedAt: string | null;
}

const COLUMNS: CsvColumn<ActivityExportRow>[] = [
  { header: "Logged At", value: (r) => r.createdAt },
  { header: "Type", value: (r) => r.type },
  { header: "Status", value: (r) => r.status },
  { header: "Actor", value: (r) => r.actorName },
  { header: "Subject", value: (r) => r.subject },
  { header: "Detail", value: (r) => r.text },
  { header: "Related To", value: (r) => r.subjectType },
  { header: "Related Id", value: (r) => r.subjectId },
  { header: "Due Date", value: (r) => r.dueDate },
  { header: "Completed At", value: (r) => r.completedAt },
];

export async function activityExportRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/crm/activities/export", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const q = exportQuery.parse(req.query ?? {});

    const subjectCol =
      q.subjectType === "contact" ? sql`a.contact_id`
      : q.subjectType === "deal" ? sql`a.deal_id`
      : q.subjectType === "account" ? sql`a.account_id`
      : null;
    const subjectF =
      subjectCol && q.subjectId ? sql`AND ${subjectCol} = ${q.subjectId}::uuid`
      : subjectCol ? sql`AND ${subjectCol} IS NOT NULL`
      : sql``;
    const typeF   = q.type   ? sql`AND a.type   = ${q.type}`   : sql``;
    const statusF = q.status ? sql`AND a.status = ${q.status}` : sql``;

    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT a.created_at AS "createdAt", a.type, a.status, a.actor_name AS "actorName",
             a.subject, a.text,
             CASE WHEN a.contact_id IS NOT NULL THEN 'contact'
                  WHEN a.deal_id    IS NOT NULL THEN 'deal'
                  WHEN a.account_id IS NOT NULL THEN 'account' END AS "subjectType",
             COALESCE(a.contact_id, a.deal_id, a.account_id) AS "subjectId",
             a.due_date::text AS "dueDate", a.completed_at AS "completedAt"
      FROM crm.activities a
      WHERE a.tenant_id = ${ctx.tenantId}
        ${subjectF} ${typeF} ${statusF}
      ORDER BY a.created_at DESC
      LIMIT ${EXPORT_CAP}
    `))) as unknown as ActivityExportRow[];

    const csv = rowsToCsv(COLUMNS, rows);

    await auditBulkExport(ctx, {
      resourceType: "activity",
      action: "activities_bulk_export",
      rowCount: rows.length,
      purpose: q.purpose,
      filters: {
        ...(q.subjectType ? { subjectType: q.subjectType } : {}),
        ...(q.subjectId ? { subjectId: q.subjectId } : {}),
        ...(q.type ? { type: q.type } : {}),
        ...(q.status ? { status: q.status } : {}),
      },
    });

    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="${exportFilename("activities")}"`);
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
