/**
 * GAP-ADMIN-BULK-SCAN-02 (H-LINK-HR): read side of the scan-link target for hr_employee.
 *
 *   GET /internal/v1/scan-link/lookup?employeeNo=&name=   service-to-service ONLY (x-internal + service secret)
 *   GET /v1/hrms/employees/:id/scanned-documents          masked metadata for the profile page
 *
 * Writes (link / unlink) are queue commands consumed by scan-link-consumer.ts; routes here are
 * read-only. No unmasked-PII reveal exists for this data, so the read route returns masked metadata only.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { and, desc, eq, or, sql, type SQL } from "drizzle-orm";
import type { LookupCandidate } from "@civitasone/scan-link";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { hrmsEmployees } from "./schema.js";
import { hrmsEmployeeScannedDocuments as t, type ScannedDocumentRow } from "./scan-link-schema.js";
import { maskPreview } from "./scan-link-mask.js";
import { candidateLabel, escapeLike, nameConfidence, nameTokens } from "./scan-link-lookup.js";

/**
 * Same gate as the employee personnel-file data (nominees / addresses): HR roles only. There is no
 * pre-existing employee-documents route; a bare "manager" / "employee" must not see scanned records.
 */
export const SCANNED_DOCS_READ_ROLES = ["hr_admin", "hr_officer", "super_admin"];
/**
 * Internal lookup: ONLY the service principal that the auth plugin builds from x-internal + INTERNAL_SERVICE_SECRET
 * (actorType "service_account"). A user token gets 403 whatever roles it carries, super_admin included
 * (same gate as finance's internal lookup).
 */
export function requireInternalServiceCall(ctx: { actorType: string }, req: { headers: Record<string, unknown> }): void {
  if (ctx.actorType !== "service_account" || req.headers["x-internal"] !== "1") {
    throw new HttpError(403, "FORBIDDEN", "internal service call required");
  }
}

const MAX_CANDIDATES = 5;
const idParam = z.object({ id: z.string().uuid() });
const lookupQuery = z.object({
  employeeNo: z.string().trim().min(1).max(64).optional(),
  name: z.string().trim().min(2).max(120).optional(),
}).refine((q) => q.employeeNo !== undefined || q.name !== undefined, { message: "employeeNo or name is required" });
const listQuery = z.object({
  state: z.enum(["linked", "unlinked", "all"]).default("linked"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export function rankCandidates(
  rows: Array<{ id: string; employeeNo: string; fullName: string }>,
  q: { employeeNo?: string | undefined; name?: string | undefined },
): LookupCandidate[] {
  const out = new Map<string, LookupCandidate>();
  const wantNo = q.employeeNo?.trim().toLowerCase();
  for (const r of rows) {
    let confidence = 0;
    if (wantNo && r.employeeNo.trim().toLowerCase() === wantNo) confidence = 1;
    else if (q.name) confidence = nameConfidence(q.name, r.fullName);
    if (confidence <= 0) continue;
    out.set(r.id, {
      target: "hr_employee", targetId: r.id, label: candidateLabel(r.employeeNo, r.fullName),
      amountMinor: null, reference: null, confidence,
    });
  }
  return [...out.values()]
    .sort((a, b) => b.confidence - a.confidence || a.label.localeCompare(b.label))
    .slice(0, MAX_CANDIDATES);
}

export function view(r: ScannedDocumentRow) {
  return {
    id: r.id,
    documentId: r.documentId,
    batchId: r.batchId,
    fileName: r.fileName,
    mimeType: r.mimeType,
    docType: r.docType,
    pageCount: r.pageCount,
    ocrConfidence: r.ocrConfidence == null ? null : Number(r.ocrConfidence),
    piiFlags: r.piiFlags,
    textPreviewMasked: maskPreview(r.textPreviewMasked),
    state: r.state,
    filedAt: r.filedAt.toISOString(),
    unlinkReason: r.state === "unlinked" ? r.unlinkReason : null,
  };
}

export async function scanLinkRoutes(app: FastifyInstance): Promise<void> {
  app.get("/internal/v1/scan-link/lookup", async (req, reply) => {
    const ctx = resolveContext(req);
    requireInternalServiceCall(ctx, req);
    const q = lookupQuery.parse(req.query ?? {});
    const conds: SQL[] = [];
    if (q.employeeNo) conds.push(sql`lower(${hrmsEmployees.employeeNo}) = ${q.employeeNo.toLowerCase()}`);
    if (q.name) {
      for (const tok of nameTokens(q.name)) {
        const pattern = `%${escapeLike(tok)}%`;
        conds.push(sql`${hrmsEmployees.fullName} ILIKE ${pattern}`);
      }
    }
    if (conds.length === 0) return reply.send({ data: [] });
    const rows = await scopedRead((tx) => tx.select({
      id: hrmsEmployees.id, employeeNo: hrmsEmployees.employeeNo, fullName: hrmsEmployees.fullName,
    }).from(hrmsEmployees)
      .where(and(eq(hrmsEmployees.tenantId, ctx.tenantId), or(...conds)))
      .limit(200));
    return reply.send({ data: rankCandidates(rows, q) });
  });

  app.get("/v1/hrms/employees/:id/scanned-documents", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SCANNED_DOCS_READ_ROLES);
    const { id } = idParam.parse(req.params);
    const q = listQuery.parse(req.query ?? {});
    const where = and(
      eq(t.tenantId, ctx.tenantId), eq(t.employeeId, id),
      q.state === "all" ? undefined : eq(t.state, q.state),
    );
    const { exists, rows, total } = await scopedRead(async (tx) => {
      const emp = await tx.select({ id: hrmsEmployees.id }).from(hrmsEmployees)
        .where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.tenantId, ctx.tenantId))).limit(1);
      if (emp.length === 0) return { exists: false, rows: [] as ScannedDocumentRow[], total: 0 };
      const list = await tx.select().from(t).where(where).orderBy(desc(t.filedAt), desc(t.id)).limit(q.limit).offset(q.offset);
      const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(t).where(where);
      return { exists: true, rows: list, total: c?.n ?? 0 };
    });
    if (!exists) throw new HttpError(404, "NOT_FOUND", "employee not found");
    // DPDP audit-on-read: ids only, never text/preview. Published (not written) so the route stays DB-write free.
    await queue.publish(COMMANDS.scanLinkDocumentsViewed, {
      messageId: randomUUID(), type: COMMANDS.scanLinkDocumentsViewed,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { employeeId: id, documentIds: rows.map((r) => r.documentId), route: "GET /v1/hrms/employees/:id/scanned-documents" },
    });
    return reply.send({ data: rows.map(view), total, hasMore: q.offset + rows.length < total });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
