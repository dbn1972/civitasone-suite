import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin"];

const MAX_SLOTS_PER_HOUR = 4; // configurable per-tenant later

const createBody = z.object({
  contactId: z.string().uuid(),
  serviceType: z.string().min(1).max(64),
  locationId: z.string().uuid().optional(),
  scheduledAt: z.string().datetime(),
  durationMinutes: z.number().int().min(5).max(480).default(30),
  notes: z.string().max(2000).optional(),
});

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  contactId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  status: z.enum(["booked", "confirmed", "completed", "cancelled", "no_show"]).optional(),
});

const patchBody = z.object({
  scheduledAt: z.string().datetime().optional(),
  durationMinutes: z.number().int().min(5).max(480).optional(),
  status: z.enum(["confirmed", "completed", "cancelled", "no_show"]).optional(),
  notes: z.string().max(2000).optional(),
});

const capacityQuery = z.object({
  locationId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const idParam = z.object({ id: z.string().uuid() });

export async function appointmentRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/crm/appointments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const body = createBody.parse(req.body);

    const rows = (await scopedRead((tx) => tx.execute(sql`
      INSERT INTO crm.appointments (tenant_id, contact_id, service_type, location_id, scheduled_at, duration_minutes, notes, created_by)
      VALUES (${ctx.tenantId}, ${body.contactId}, ${body.serviceType}, ${body.locationId ?? null},
              ${body.scheduledAt}, ${body.durationMinutes}, ${body.notes ?? null}, ${ctx.actorId})
      RETURNING id, tenant_id AS "tenantId", contact_id AS "contactId", service_type AS "serviceType",
                location_id AS "locationId", scheduled_at AS "scheduledAt", duration_minutes AS "durationMinutes",
                status, notes, created_by AS "createdBy", version, created_at AS "createdAt"
    `))) as unknown as Array<Record<string, unknown>>;
    return reply.code(201).send({ data: rows[0] });
  });

  app.get("/v1/crm/appointments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = listQuery.parse(req.query);

    const contactFilter = q.contactId ? sql`AND contact_id = ${q.contactId}` : sql``;
    const locationFilter = q.locationId ? sql`AND location_id = ${q.locationId}` : sql``;
    const dateFromFilter = q.dateFrom ? sql`AND scheduled_at >= ${q.dateFrom}::timestamptz` : sql``;
    const dateToFilter = q.dateTo ? sql`AND scheduled_at <= ${q.dateTo}::timestamptz` : sql``;
    const statusFilter = q.status ? sql`AND status = ${q.status}` : sql``;

    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT id, tenant_id AS "tenantId", contact_id AS "contactId", service_type AS "serviceType",
             location_id AS "locationId", scheduled_at AS "scheduledAt", duration_minutes AS "durationMinutes",
             status, notes, created_by AS "createdBy", version, created_at AS "createdAt"
      FROM crm.appointments
      WHERE tenant_id = ${ctx.tenantId}
        ${contactFilter} ${locationFilter} ${dateFromFilter} ${dateToFilter} ${statusFilter}
      ORDER BY scheduled_at ASC
      LIMIT ${q.limit} OFFSET ${q.offset}
    `))) as unknown as Array<Record<string, unknown>>;
    return reply.send({ data: rows, meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total: rows.length } });
  });

  app.patch("/v1/crm/appointments/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = patchBody.parse(req.body);

    if (Object.keys(body).length === 0) {
      throw new HttpError(400, "EMPTY_BODY", "at least one field must be provided");
    }

    // Build dynamic SET clause
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (body.scheduledAt !== undefined) { sets.push("scheduled_at = $S_AT"); vals.push(body.scheduledAt); }
    if (body.durationMinutes !== undefined) { sets.push("duration_minutes = $DUR"); vals.push(body.durationMinutes); }
    if (body.status !== undefined) { sets.push("status = $ST"); vals.push(body.status); }
    if (body.notes !== undefined) { sets.push("notes = $N"); vals.push(body.notes); }

    // Use raw sql for simpler updates
    const result = (await scopedRead((tx) => tx.execute(sql`
      UPDATE crm.appointments
      SET scheduled_at = COALESCE(${body.scheduledAt ?? null}::timestamptz, scheduled_at),
          duration_minutes = COALESCE(${body.durationMinutes ?? null}::int, duration_minutes),
          status = COALESCE(${body.status ?? null}::varchar, status),
          notes = COALESCE(${body.notes ?? null}::text, notes),
          version = version + 1,
          updated_at = now()
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
      RETURNING id, status, version
    `))) as unknown as Array<Record<string, unknown>>;

    if (result.length === 0) {
      throw new HttpError(404, "NOT_FOUND", "appointment not found");
    }
    return reply.send({ data: result[0] });
  });

  // Capacity endpoint: available slots per hour on a given date/location
  app.get("/v1/crm/appointments/capacity", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = capacityQuery.parse(req.query);

    const dateStart = `${q.date}T00:00:00Z`;
    const dateEnd = `${q.date}T23:59:59Z`;

    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT date_trunc('hour', scheduled_at) AS "hour",
             COUNT(*)::int AS "booked"
      FROM crm.appointments
      WHERE tenant_id = ${ctx.tenantId}
        AND location_id = ${q.locationId}
        AND scheduled_at >= ${dateStart}::timestamptz
        AND scheduled_at <= ${dateEnd}::timestamptz
        AND status NOT IN ('cancelled')
      GROUP BY date_trunc('hour', scheduled_at)
      ORDER BY "hour"
    `))) as unknown as Array<{ hour: string; booked: number }>;

    const slots = rows.map((r) => ({
      hour: r.hour,
      booked: r.booked,
      available: Math.max(0, MAX_SLOTS_PER_HOUR - r.booked),
      maxCapacity: MAX_SLOTS_PER_HOUR,
    }));

    return reply.send({ data: slots, meta: { locationId: q.locationId, date: q.date, maxPerHour: MAX_SLOTS_PER_HOUR } });
  });
}
