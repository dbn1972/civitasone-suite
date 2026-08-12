import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { listQuery, windowOf, listEnvelope } from "../../shared/list-query.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];
const ADMIN_ROLES = ["crm_admin", "super_admin", "tenant_admin"];

const PRIORITY = ["low", "normal", "high", "urgent"] as const;
const STATUS = ["open", "assigned", "in_progress", "resolved", "closed", "escalated"] as const;

const createBody = z.object({
  contactId: z.string().uuid().optional(),
  citizenName: z.string().min(1).max(200),
  citizenPhone: z.string().min(3).max(32).optional(),
  citizenEmail: z.string().email().max(320).optional(),
  category: z.string().min(1).max(64),
  subject: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  priority: z.enum(PRIORITY).default("normal"),
  dueAt: z.string().datetime().optional(),
});

const listParams = listQuery.extend({
  status: z.enum(STATUS).optional(),
  priority: z.enum(PRIORITY).optional(),
  category: z.string().max(64).optional(),
  assignedTo: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
});

const assignBody = z.object({ assignedTo: z.string().uuid() });
const resolveBody = z.object({ resolution: z.string().min(1).max(5000) });
const escalateBody = z.object({ reason: z.string().max(1000).optional() }).optional();

const idParam = z.object({ id: z.string().uuid() });

/** Build a short human-readable reference: GRV/YYYY/NNNNNNs */
function grievanceRef(): string {
  const yr = new Date().getFullYear();
  const suffix = Date.now().toString(36).toUpperCase().slice(-6);
  return `GRV/${yr}/${suffix}`;
}

export async function grievanceRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/crm/grievances — create a new grievance
  app.post("/v1/crm/grievances", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const body = createBody.parse(req.body);
    const refNo = grievanceRef();

    const rows = (await scopedRead((tx) => tx.execute(sql`
      INSERT INTO crm.grievances (
        tenant_id, contact_id, citizen_name, citizen_phone, citizen_email,
        category, subject, description, priority, status,
        due_at, reference_no, created_by, updated_by
      ) VALUES (
        ${ctx.tenantId}, ${body.contactId ?? null}, ${body.citizenName},
        ${body.citizenPhone ?? null}, ${body.citizenEmail ?? null},
        ${body.category}, ${body.subject}, ${body.description ?? null},
        ${body.priority}, 'open',
        ${body.dueAt ?? null}, ${refNo}, ${ctx.actorId}, ${ctx.actorId}
      )
      RETURNING id, reference_no AS "referenceNo",
                citizen_name AS "citizenName", category, subject,
                priority, status, created_at AS "createdAt"
    `))) as unknown as Array<Record<string, unknown>>;
    return reply.code(201).send({ data: rows[0] });
  });

  // GET /v1/crm/grievances — list grievances with filters
  app.get("/v1/crm/grievances", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = listParams.parse(req.query ?? {});
    const w = windowOf(q);

    const statusF  = q.status    ? sql`AND g.status   = ${q.status}`           : sql``;
    const priorityF = q.priority ? sql`AND g.priority  = ${q.priority}`         : sql``;
    const categoryF = q.category ? sql`AND g.category  = ${q.category}`         : sql``;
    const assignedF = q.assignedTo ? sql`AND g.assigned_to = ${q.assignedTo}::uuid` : sql``;
    const searchF = q.search
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

  // GET /v1/crm/grievances/:id — detail
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
          status = CASE WHEN status = 'open' THEN 'assigned' ELSE status END,
          updated_by = ${ctx.actorId}, updated_at = now(), version = version + 1
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
      RETURNING id, status, assigned_to AS "assignedTo", version
    `))) as unknown as Array<Record<string, unknown>>;

    if (rows.length === 0) throw new HttpError(404, "NOT_FOUND", "grievance not found");
    return reply.send({ data: rows[0] });
  });

  // PATCH /v1/crm/grievances/:id/resolve
  app.patch("/v1/crm/grievances/:id/resolve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = resolveBody.parse(req.body);

    const rows = (await scopedRead((tx) => tx.execute(sql`
      UPDATE crm.grievances
      SET status = 'resolved', resolution = ${body.resolution},
          resolved_at = now(),
          updated_by = ${ctx.actorId}, updated_at = now(), version = version + 1
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
        AND status NOT IN ('closed')
      RETURNING id, status, resolved_at AS "resolvedAt", version
    `))) as unknown as Array<Record<string, unknown>>;

    if (rows.length === 0)
      throw new HttpError(404, "NOT_FOUND", "grievance not found or already closed");
    return reply.send({ data: rows[0] });
  });

  // PATCH /v1/crm/grievances/:id/close
  app.patch("/v1/crm/grievances/:id/close", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);

    const rows = (await scopedRead((tx) => tx.execute(sql`
      UPDATE crm.grievances
      SET status = 'closed', closed_at = now(),
          updated_by = ${ctx.actorId}, updated_at = now(), version = version + 1
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND status != 'closed'
      RETURNING id, status, closed_at AS "closedAt", version
    `))) as unknown as Array<Record<string, unknown>>;

    if (rows.length === 0)
      throw new HttpError(404, "NOT_FOUND", "grievance not found or already closed");
    return reply.send({ data: rows[0] });
  });

  // PATCH /v1/crm/grievances/:id/escalate
  app.patch("/v1/crm/grievances/:id/escalate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    escalateBody?.parse(req.body ?? {});

    const rows = (await scopedRead((tx) => tx.execute(sql`
      UPDATE crm.grievances
      SET status = 'escalated', priority = 'urgent', escalated_at = now(),
          updated_by = ${ctx.actorId}, updated_at = now(), version = version + 1
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
        AND status NOT IN ('closed', 'resolved')
      RETURNING id, status, priority, escalated_at AS "escalatedAt", version
    `))) as unknown as Array<Record<string, unknown>>;

    if (rows.length === 0)
      throw new HttpError(404, "NOT_FOUND", "grievance not found or already resolved/closed");
    return reply.send({ data: rows[0] });
  });

  // GET /v1/crm/grievances/stats — dashboard KPIs
  app.get("/v1/crm/grievances/stats", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);

    const [row] = (await scopedRead((tx) => tx.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status NOT IN ('closed', 'resolved'))::int AS "openCount",
        COUNT(*) FILTER (WHERE status = 'resolved' AND resolved_at IS NOT NULL)::int AS "resolvedCount",
        COUNT(*) FILTER (WHERE status = 'escalated')::int AS "escalatedCount",
        ROUND(
          AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600) FILTER (WHERE resolved_at IS NOT NULL)
        )::int AS "avgResolutionHours"
      FROM crm.grievances
      WHERE tenant_id = ${ctx.tenantId}
    `))) as unknown as Array<Record<string, unknown>>;

    return reply.send({ data: row ?? { openCount: 0, resolvedCount: 0, escalatedCount: 0, avgResolutionHours: null } });
  });
}
