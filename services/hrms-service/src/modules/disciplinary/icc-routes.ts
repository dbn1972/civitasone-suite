import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * ICC / POSH complaint CRUD (Sprint 4: T25–T29).
 *
 *   POST /v1/hrms/icc/complaints                file a complaint (confidential)
 *   GET  /v1/hrms/icc/complaints                 list complaints (ICC-role gated, masked)
 *   GET  /v1/hrms/icc/complaints/:id             full detail incl. identity (icc_member ONLY)
 *   POST /v1/hrms/icc/complaints/:id/hearings    record a hearing
 *   GET  /v1/hrms/icc/complaints/:id/hearings    list hearings
 *
 * POSH Act 2013, §16 — "contents of the complaint... the identity and
 * addresses of the aggrieved woman, respondent and witnesses... shall not
 * be published, communicated or made known to the public, press and media
 * in any manner." GAP-HR-ICC-01/02's fix: the LIST route never sends
 * complainantId/respondentId/createdBy/tenantId/iccMembersOnly to ANY
 * caller (an explicit column allow-list, not a hope that the frontend
 * strips them); only a dedicated, icc_member-only DETAIL route can ever
 * return identity, per the published decision packet's own recommendation
 * ("identity only through a dedicated icc_member-only detail route,
 * audited... the statutory default, not really optional").
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { eq, and, desc, sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db, scopedRead } from "../../shared/db.js";
import { auditLog } from "../../shared/audit-log.js";
import { hrmsIccComplaints, hrmsIccHearings } from "./schema.js";

// GAP-HR-ICC-02/06: the register itself (masked) is reachable by hr_admin/
// super_admin/icc_member -- but SEEING IDENTITY (the detail route below) is
// icc_member-only, deliberately excluding hr_admin/super_admin. A chairing
// hr_admin needs the icc_member role granted to them, not a code bypass --
// see this route's own comment.
const ICC_ROLES = ["hr_admin", "super_admin", "icc_member"];
const IDENTITY_ROLES = ["icc_member"];
const idParam = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  limit: z.coerce.number().int().positive().max(200).default(100),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export async function iccRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/hrms/icc/complaints", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ICC_ROLES);
    const body = z.object({
      complainantId: z.string().uuid(),
      respondentId: z.string().uuid().optional(),
      summary: z.string().min(10).max(5000),
    }).parse(req.body);
    const id = randomUUID();
    await publishF3Write(ctx, "disciplinary_icc_routes__0", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id, status: "filed", confidential: true }) as any;
  });

  // GAP-HR-ICC-01/02/05: explicit column projection (never complainantId/
  // respondentId/createdBy/tenantId/iccMembersOnly), iccMembersOnly enforced
  // in the WHERE clause (was selected but never filtered on), summary masked
  // unless the row is non-confidential OR the caller is icc_member,
  // limit/offset + total (was a hard, silent LIMIT 100), and an audit event
  // on every read (GAP-HR-ICC-02 fix step 4).
  app.get("/v1/hrms/icc/complaints", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ICC_ROLES);
    const q = listQuery.parse(req.query);
    const isIccMember = ctx.roles.includes("icc_member");

    // icc_members_only was selected but never referenced in the WHERE
    // clause -- a non-ICC-member hr_admin/super_admin caller got every row
    // regardless of this flag.
    const conditions = [eq(hrmsIccComplaints.tenantId, ctx.tenantId)];
    if (!isIccMember) conditions.push(eq(hrmsIccComplaints.iccMembersOnly, false));

    const rows = await scopedRead((tx) => tx
      .select({
        id: hrmsIccComplaints.id,
        caseNo: hrmsIccComplaints.caseNo,
        summary: hrmsIccComplaints.summary,
        filedAt: hrmsIccComplaints.filedAt,
        status: hrmsIccComplaints.status,
        confidential: hrmsIccComplaints.confidential,
        totalCount: sql<number>`count(*) over()`.mapWith(Number),
      })
      .from(hrmsIccComplaints)
      .where(and(...conditions))
      .orderBy(desc(hrmsIccComplaints.filedAt))
      .limit(q.limit)
      .offset(q.offset));

    const total = rows[0]?.totalCount ?? 0;
    const data = rows.map((r) => ({
      id: r.id,
      // Fallback for any pre-migration-0157 row a backfill somehow missed --
      // never a bare null the web would render as "ICC/null".
      caseNo: r.caseNo ?? `ICC/${r.id.slice(0, 8).toUpperCase()}`,
      filedAt: r.filedAt,
      status: r.status,
      confidential: r.confidential,
      summary: (!r.confidential || isIccMember) ? r.summary : null,
    }));

    await db.transaction((tx) => auditLog(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      action: "read_list",
      resourceType: "icc_complaint",
      correlationId: ctx.correlationId,
      payload: { count: data.length },
    }));

    return reply.send({ data, total });
  });

  // GAP-HR-ICC-02/03: the ONLY route that ever returns complainantId/
  // respondentId -- icc_member-only (see IDENTITY_ROLES's own comment
  // above), audited per read. Backs GAP-HR-ICC-03's detail/hearing view.
  app.get("/v1/hrms/icc/complaints/:id", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, IDENTITY_ROLES);
    const { id } = idParam.parse(req.params);
    const rows = await scopedRead((tx) => tx.select().from(hrmsIccComplaints)
      .where(and(eq(hrmsIccComplaints.id, id), eq(hrmsIccComplaints.tenantId, ctx.tenantId)))
      .limit(1));
    const row = rows[0];
    if (!row) throw new HttpError(404, "NOT_FOUND", "ICC complaint not found");

    await db.transaction((tx) => auditLog(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      action: "read_detail",
      resourceType: "icc_complaint",
      resourceId: id,
      correlationId: ctx.correlationId,
    }));

    return reply.send({
      data: {
        id: row.id,
        caseNo: row.caseNo ?? `ICC/${row.id.slice(0, 8).toUpperCase()}`,
        complainantId: row.complainantId,
        respondentId: row.respondentId,
        summary: row.summary,
        filedAt: row.filedAt,
        status: row.status,
        confidential: row.confidential,
      },
    });
  });

  app.post("/v1/hrms/icc/complaints/:id/hearings", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ICC_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      hearingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      notes: z.string().max(5000).optional(),
      finding: z.string().max(24).optional(),
    }).parse(req.body);
    const hid = randomUUID();
    await publishF3Write(ctx, "disciplinary_icc_routes__1", hid, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id: hid, complaintId: id }) as any;
  });

  app.get("/v1/hrms/icc/complaints/:id/hearings", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, ICC_ROLES);
    const { id } = idParam.parse(req.params);
    const rows = await scopedRead((tx) => tx.select().from(hrmsIccHearings)
      .where(and(eq(hrmsIccHearings.tenantId, ctx.tenantId), eq(hrmsIccHearings.complaintId, id))));
    return reply.send({ data: rows });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
