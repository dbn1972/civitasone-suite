import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { listQuery, windowOf, listEnvelope } from "../../shared/list-query.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];
const ADMIN_ROLES = ["crm_admin", "super_admin", "tenant_admin"];

const PRIORITY = ["low", "normal", "high", "urgent"] as const;
const STATUS = ["open", "in_progress", "pending", "resolved", "closed", "cancelled"] as const;

const createBody = z.object({
  contactId: z.string().uuid().optional(),
  citizenName: z.string().min(1).max(200),
  citizenPhone: z.string().min(3).max(32).optional(),
  citizenEmail: z.string().email().max(320).optional(),
  serviceType: z.string().min(1).max(64),
  subject: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  priority: z.enum(PRIORITY).default("normal"),
  dueAt: z.string().datetime().optional(),
});

const listParams = listQuery.extend({
  status: z.enum(STATUS).optional(),
  priority: z.enum(PRIORITY).optional(),
  serviceType: z.string().max(64).optional(),
  assignedTo: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
});

const updateStatusBody = z.object({
  status: z.enum(STATUS),
  resolution: z.string().max(5000).optional(),
  assignedTo: z.string().uuid().optional(),
});

const idParam = z.object({ id: z.string().uuid() });

function srRef(): string {
  const yr = new Date().getFullYear();
  const suffix = Date.now().toString(36).toUpperCase().slice(-6);
  return `SRQ/${yr}/${suffix}`;
}

export async function serviceRequestRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/crm/service-requests
  app.post("/v1/crm/service-requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const body = createBody.parse(req.body);
    const refNo = srRef();

    const rows = (await scopedRead((tx) => tx.execute(sql`
      INSERT INTO crm.service_requests (
        tenant_id, contact_id, citizen_name, citizen_phone, citizen_email,
        service_type, subject, description, priority, status,
        due_at, reference_no, created_by, updated_by
      ) VALUES (
        ${ctx.tenantId}, ${body.contactId ?? null}, ${body.citizenName},
        ${body.citizenPhone ?? null}, ${body.citizenEmail ?? null},
        ${body.serviceType}, ${body.subject}, ${body.description ?? null},
        ${body.priority}, 'open',
        ${body.dueAt ?? null}, ${refNo}, ${ctx.actorId}, ${ctx.actorId}
      )
      RETURNING id, reference_no AS "referenceNo",
                citizen_name AS "citizenName", service_type AS "serviceType",
                subject, priority, status, created_at AS "createdAt"
    `))) as unknown as Array<Record<string, unknown>>;
    return reply.code(201).send({ data: rows[0] });
  });

  // GET /v1/crm/service-requests
  app.get("/v1/crm/service-requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = listParams.parse(req.query ?? {});
    const w = windowOf(q);

    const statusF     = q.status      ? sql`AND r.status       = ${q.status}`             : sql``;
    const priorityF   = q.priority    ? sql`AND r.priority      = ${q.priority}`           : sql``;
    const typeF       = q.serviceType ? sql`AND r.service_type  = ${q.serviceType}`        : sql``;
    const assignedF   = q.assignedTo  ? sql`AND r.assigned_to   = ${q.assignedTo}::uuid`  : sql``;
    const searchF = q.search
      ? sql`AND (r.citizen_name ILIKE ${"%" + q.search + "%"}
                 OR r.subject    ILIKE ${"%" + q.search + "%"}
                 OR r.reference_no ILIKE ${"%" + q.search + "%"})`
      : sql``;

    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT r.id, r.reference_no AS "referenceNo", r.citizen_name AS "citizenName",
             r.citizen_phone AS "citizenPhone", r.service_type AS "serviceType",
             r.subject, r.priority, r.status,
             r.assigned_to AS "assignedTo", r.contact_id AS "contactId",
             r.due_at AS "dueAt", r.resolved_at AS "resolvedAt",
             r.created_at AS "createdAt", r.updated_at AS "updatedAt", r.version
      FROM crm.service_requests r
      WHERE r.tenant_id = ${ctx.tenantId}
        ${statusF} ${priorityF} ${typeF} ${assignedF} ${searchF}
      ORDER BY
        CASE r.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
        r.created_at DESC
      LIMIT ${w.pageSize} OFFSET ${w.offset}
    `))) as unknown as Array<Record<string, unknown>>;

    const [ct] = (await scopedRead((tx) => tx.execute(sql`
      SELECT COUNT(*)::int AS total FROM crm.service_requests r
      WHERE r.tenant_id = ${ctx.tenantId}
        ${statusF} ${priorityF} ${typeF} ${assignedF} ${searchF}
    `))) as unknown as Array<{ total: number }>;

    return reply.send(listEnvelope(rows, w, ct?.total ?? 0));
  });

  // GET /v1/crm/service-requests/:id
  app.get("/v1/crm/service-requests/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);

    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT r.id, r.reference_no AS "referenceNo", r.citizen_name AS "citizenName",
             r.citizen_phone AS "citizenPhone", r.citizen_email AS "citizenEmail",
             r.service_type AS "serviceType", r.subject, r.description,
             r.priority, r.status, r.assigned_to AS "assignedTo",
             r.contact_id AS "contactId", r.resolution,
             r.due_at AS "dueAt", r.resolved_at AS "resolvedAt",
             r.closed_at AS "closedAt",
             r.created_at AS "createdAt", r.updated_at AS "updatedAt",
             r.created_by AS "createdBy", r.version
      FROM crm.service_requests r
      WHERE r.id = ${id} AND r.tenant_id = ${ctx.tenantId}
    `))) as unknown as Array<Record<string, unknown>>;

    if (rows.length === 0) throw new HttpError(404, "NOT_FOUND", "service request not found");
    return reply.send({ data: rows[0] });
  });

  // PATCH /v1/crm/service-requests/:id/status — update status / close
  app.patch("/v1/crm/service-requests/:id/status", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateStatusBody.parse(req.body);

    if (body.status === "closed" || body.status === "cancelled") {
      requireRole(ctx, ADMIN_ROLES);
    }

    const rows = (await scopedRead((tx) => tx.execute(sql`
      UPDATE crm.service_requests
      SET status = ${body.status},
          resolution = COALESCE(${body.resolution ?? null}, resolution),
          assigned_to = COALESCE(${body.assignedTo ?? null}::uuid, assigned_to),
          resolved_at = CASE WHEN ${body.status} = 'resolved' AND resolved_at IS NULL THEN now() ELSE resolved_at END,
          closed_at   = CASE WHEN ${body.status} IN ('closed', 'cancelled') AND closed_at IS NULL THEN now() ELSE closed_at END,
          updated_by = ${ctx.actorId}, updated_at = now(), version = version + 1
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
        AND status NOT IN ('closed', 'cancelled')
      RETURNING id, status, assigned_to AS "assignedTo", resolved_at AS "resolvedAt",
                closed_at AS "closedAt", version
    `))) as unknown as Array<Record<string, unknown>>;

    if (rows.length === 0)
      throw new HttpError(404, "NOT_FOUND", "service request not found or already closed");
    return reply.send({ data: rows[0] });
  });
}
