import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { listQuery, windowOf, listEnvelope } from "../../shared/list-query.js";
import {
  STATUS,
  PRIORITY,
  MINISTRY_CODE,
  createBody,
  assignBody,
  resolveBody,
  forwardBody,
  appealBody,
} from "./grievances-domain.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];
const ADMIN_ROLES = ["crm_admin", "super_admin", "tenant_admin"];

const listParams = listQuery.extend({
  status: z.enum(STATUS).optional(),
  priority: z.enum(PRIORITY).optional(),
  category: z.string().max(64).optional(),
  assignedTo: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
});

const idParam = z.object({ id: z.string().uuid() });

export async function grievanceRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/crm/grievances — create grievance with CPGRAMS-aligned reference number
  app.post("/v1/crm/grievances", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const body = createBody.parse(req.body);

    const rows = (await scopedRead(async (tx) => {
      // Ministry-prefixed reference: DARPG/2026/000001
      const [seqRow] = (await tx.execute(
        sql`SELECT nextval('"crm"."grievance_ref_seq"')::bigint AS seq`
      )) as Array<{ seq: number }>;
      const yr = new Date().getFullYear();
      const seq = Number(seqRow.seq).toString().padStart(6, "0");
      const refNo = `${MINISTRY_CODE}/${yr}/${seq}`;

      return tx.execute(sql`
        INSERT INTO crm.grievances (
          tenant_id, contact_id, citizen_name, citizen_phone, citizen_email,
          category, subject, description, priority, status,
          due_at, reference_no, created_by, updated_by
        ) VALUES (
          ${ctx.tenantId}, ${body.contactId ?? null}, ${body.citizenName},
          ${body.citizenPhone ?? null}, ${body.citizenEmail ?? null},
          ${body.category}, ${body.subject}, ${body.description ?? null},
          ${body.priority}, 'REGISTERED',
          ${body.dueAt ?? null}, ${refNo}, ${ctx.actorId}, ${ctx.actorId}
        )
        RETURNING id, reference_no AS "referenceNo",
                  citizen_name AS "citizenName", category, subject,
                  priority, status, created_at AS "createdAt"
      `);
    })) as unknown as Array<Record<string, unknown>>;
    return reply.code(201).send({ data: rows[0] });
  });

  // GET /v1/crm/grievances — list with CPGRAMS status filters
  app.get("/v1/crm/grievances", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = listParams.parse(req.query ?? {});
    const w = windowOf(q);

    const statusF   = q.status     ? sql`AND g.status    = ${q.status}`               : sql``;
    const priorityF = q.priority   ? sql`AND g.priority  = ${q.priority}`             : sql``;
    const categoryF = q.category   ? sql`AND g.category  = ${q.category}`             : sql``;
    const assignedF = q.assignedTo ? sql`AND g.assigned_to = ${q.assignedTo}::uuid`   : sql``;
    const searchF   = q.search
      ? sql`AND (g.citizen_name ILIKE ${"%" + q.search + "%"}
                 OR g.subject   ILIKE ${"%" + q.search + "%"}
                 OR g.reference_no ILIKE ${"%" + q.search + "%"})`
      : sql``;

    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT g.id, g.reference_no AS "referenceNo", g.citizen_name AS "citizenName",
             g.citizen_phone AS "citizenPhone", g.citizen_email AS "citizenEmail",
             g.category, g.subject, g.priority, g.status,
             g.assigned_to AS "assignedTo", g.contact_id AS "contactId",
             g.due_at AS "dueAt", g.resolved_at AS "resolvedAt",
             g.escalated_at AS "escalatedAt",
             g.created_at AS "createdAt", g.updated_at AS "updatedAt", g.version
      FROM crm.grievances g
      WHERE g.tenant_id = ${ctx.tenantId}
        ${statusF} ${priorityF} ${categoryF} ${assignedF} ${searchF}
      ORDER BY
        CASE g.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
        g.created_at DESC
      LIMIT ${w.pageSize} OFFSET ${w.offset}
    `))) as unknown as Array<Record<string, unknown>>;

    const [ct] = (await scopedRead((tx) => tx.execute(sql`
      SELECT COUNT(*)::int AS total FROM crm.grievances g
      WHERE g.tenant_id = ${ctx.tenantId}
        ${statusF} ${priorityF} ${categoryF} ${assignedF} ${searchF}
    `))) as unknown as Array<{ total: number }>;

    return reply.send(listEnvelope(rows, w, ct?.total ?? 0));
  });

  // GET /v1/crm/grievances/stats — KPIs (must register before /:id to avoid routing conflict)
  app.get("/v1/crm/grievances/stats", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);

    const [row] = (await scopedRead((tx) => tx.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status != 'DISPOSED')::int          AS "openCount",
        COUNT(*) FILTER (WHERE status = 'DISPOSED'
                           AND resolved_at IS NOT NULL)::int       AS "resolvedCount",
        COUNT(*) FILTER (WHERE status = 'APPEAL')::int             AS "escalatedCount",
        ROUND(
          AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600)
          FILTER (WHERE resolved_at IS NOT NULL)
        )::int                                                     AS "avgResolutionHours"
      FROM crm.grievances
      WHERE tenant_id = ${ctx.tenantId}
    `))) as unknown as Array<Record<string, unknown>>;

    return reply.send({
      data: row ?? { openCount: 0, resolvedCount: 0, escalatedCount: 0, avgResolutionHours: null },
    });
  });

  // GET /v1/crm/grievances/:id — detail (exposes forwarded_to, appeal_reason)
  app.get("/v1/crm/grievances/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);

    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT g.id, g.reference_no AS "referenceNo", g.citizen_name AS "citizenName",
             g.citizen_phone AS "citizenPhone", g.citizen_email AS "citizenEmail",
             g.category, g.subject, g.description, g.priority, g.status,
             g.assigned_to AS "assignedTo", g.contact_id AS "contactId",
             g.resolution, g.due_at AS "dueAt",
             g.resolved_at AS "resolvedAt", g.closed_at AS "closedAt",
             g.escalated_at AS "escalatedAt",
             g.forwarded_to AS "forwardedTo", g.forwarded_at AS "forwardedAt",
             g.appeal_reason AS "appealReason",
             g.created_at AS "createdAt", g.updated_at AS "updatedAt",
             g.created_by AS "createdBy", g.version
      FROM crm.grievances g
      WHERE g.id = ${id} AND g.tenant_id = ${ctx.tenantId}
    `))) as unknown as Array<Record<string, unknown>>;

    if (rows.length === 0) throw new HttpError(404, "NOT_FOUND", "grievance not found");
    return reply.send({ data: rows[0] });
  });

  // PATCH /v1/crm/grievances/:id/assign
  app.patch("/v1/crm/grievances/:id/assign", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = assignBody.parse(req.body);

    const rows = (await scopedRead((tx) => tx.execute(sql`
      UPDATE crm.grievances
      SET assigned_to = ${body.assignedTo}::uuid,
          status = CASE WHEN status = 'REGISTERED' THEN 'FORWARDED' ELSE status END,
          updated_by = ${ctx.actorId}, updated_at = now(), version = version + 1
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
      RETURNING id, status, assigned_to AS "assignedTo", version
    `))) as unknown as Array<Record<string, unknown>>;

    if (rows.length === 0) throw new HttpError(404, "NOT_FOUND", "grievance not found");
    return reply.send({ data: rows[0] });
  });

  // PATCH /v1/crm/grievances/:id/forward — CPGRAMS: forward to department/office
  app.patch("/v1/crm/grievances/:id/forward", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = forwardBody.parse(req.body);

    const rows = (await scopedRead((tx) => tx.execute(sql`
      UPDATE crm.grievances
      SET status = 'FORWARDED',
          forwarded_to = ${body.forwardedTo},
          forwarded_at = now(),
          updated_by = ${ctx.actorId}, updated_at = now(), version = version + 1
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
        AND status != 'DISPOSED'
      RETURNING id, status,
                forwarded_to AS "forwardedTo", forwarded_at AS "forwardedAt",
                version
    `))) as unknown as Array<Record<string, unknown>>;

    if (rows.length === 0)
      throw new HttpError(404, "NOT_FOUND", "grievance not found or already disposed");
    return reply.send({ data: rows[0] });
  });

  // PATCH /v1/crm/grievances/:id/resolve — sets DISPOSED (CPGRAMS: attended and disposed)
  app.patch("/v1/crm/grievances/:id/resolve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = resolveBody.parse(req.body);

    const rows = (await scopedRead((tx) => tx.execute(sql`
      UPDATE crm.grievances
      SET status = 'DISPOSED', resolution = ${body.resolution},
          resolved_at = now(),
          updated_by = ${ctx.actorId}, updated_at = now(), version = version + 1
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
        AND status != 'DISPOSED'
      RETURNING id, status, resolved_at AS "resolvedAt", version
    `))) as unknown as Array<Record<string, unknown>>;

    if (rows.length === 0)
      throw new HttpError(404, "NOT_FOUND", "grievance not found or already disposed");
    return reply.send({ data: rows[0] });
  });

  // PATCH /v1/crm/grievances/:id/close — admin: administratively dispose
  app.patch("/v1/crm/grievances/:id/close", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);

    const rows = (await scopedRead((tx) => tx.execute(sql`
      UPDATE crm.grievances
      SET status = 'DISPOSED', closed_at = now(),
          updated_by = ${ctx.actorId}, updated_at = now(), version = version + 1
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
        AND status != 'DISPOSED'
      RETURNING id, status, closed_at AS "closedAt", version
    `))) as unknown as Array<Record<string, unknown>>;

    if (rows.length === 0)
      throw new HttpError(404, "NOT_FOUND", "grievance not found or already disposed");
    return reply.send({ data: rows[0] });
  });

  // PATCH /v1/crm/grievances/:id/escalate — legacy alias; transitions to APPEAL
  app.patch("/v1/crm/grievances/:id/escalate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);

    const rows = (await scopedRead((tx) => tx.execute(sql`
      UPDATE crm.grievances
      SET status = 'APPEAL', priority = 'urgent', escalated_at = now(),
          updated_by = ${ctx.actorId}, updated_at = now(), version = version + 1
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
        AND status != 'DISPOSED'
      RETURNING id, status, priority, escalated_at AS "escalatedAt", version
    `))) as unknown as Array<Record<string, unknown>>;

    if (rows.length === 0)
      throw new HttpError(404, "NOT_FOUND", "grievance not found or already disposed");
    return reply.send({ data: rows[0] });
  });

  // PATCH /v1/crm/grievances/:id/first-appeal — CPGRAMS: citizen files a first appeal
  app.patch("/v1/crm/grievances/:id/first-appeal", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = appealBody.parse(req.body ?? {});

    const rows = (await scopedRead((tx) => tx.execute(sql`
      UPDATE crm.grievances
      SET status = 'APPEAL', priority = 'urgent',
          appeal_reason = ${body.appealReason ?? null},
          escalated_at = now(),
          updated_by = ${ctx.actorId}, updated_at = now(), version = version + 1
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
        AND status != 'DISPOSED'
      RETURNING id, status, priority,
                appeal_reason AS "appealReason",
                escalated_at AS "escalatedAt", version
    `))) as unknown as Array<Record<string, unknown>>;

    if (rows.length === 0)
      throw new HttpError(404, "NOT_FOUND", "grievance not found or already disposed");
    return reply.send({ data: rows[0] });
  });
}
