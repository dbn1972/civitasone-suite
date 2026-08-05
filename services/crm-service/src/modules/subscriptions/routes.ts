import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin"];

const createBody = z.object({
  contactId: z.string().uuid(),
  productId: z.string().uuid(),
  type: z.enum(["recurring", "deposit", "membership"]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  nextDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  frequency: z.enum(["monthly", "quarterly", "annual"]),
  amountMinor: z.number().int().min(0),
  currency: z.string().length(3).default("INR"),
  autoRenew: z.boolean().default(true),
});

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  contactId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  status: z.enum(["active", "paused", "cancelled", "expired"]).optional(),
});

const patchBody = z.object({
  status: z.enum(["paused", "cancelled", "active"]).optional(),
  autoRenew: z.boolean().optional(),
  nextDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const dueQuery = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
});

const idParam = z.object({ id: z.string().uuid() });

export async function subscriptionRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/crm/subscriptions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const body = createBody.parse(req.body);

    const rows = (await scopedRead((tx) => tx.execute(sql`
      INSERT INTO crm.subscriptions (tenant_id, contact_id, product_id, type, start_date,
                                     next_due_date, frequency, amount_minor, currency, auto_renew, created_by)
      VALUES (${ctx.tenantId}, ${body.contactId}, ${body.productId}, ${body.type},
              ${body.startDate}, ${body.nextDueDate ?? body.startDate}, ${body.frequency},
              ${body.amountMinor}, ${body.currency}, ${body.autoRenew}, ${ctx.actorId})
      RETURNING id, tenant_id AS "tenantId", contact_id AS "contactId", product_id AS "productId",
                type, status, start_date AS "startDate", next_due_date AS "nextDueDate",
                frequency, amount_minor::text AS "amountMinor", currency, auto_renew AS "autoRenew",
                version, created_at AS "createdAt"
    `))) as unknown as Array<Record<string, unknown>>;
    return reply.code(201).send({ data: rows[0] });
  });

  app.get("/v1/crm/subscriptions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = listQuery.parse(req.query);

    const contactFilter = q.contactId ? sql`AND contact_id = ${q.contactId}` : sql``;
    const productFilter = q.productId ? sql`AND product_id = ${q.productId}` : sql``;
    const statusFilter = q.status ? sql`AND status = ${q.status}` : sql``;

    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT id, tenant_id AS "tenantId", contact_id AS "contactId", product_id AS "productId",
             type, status, start_date AS "startDate", next_due_date AS "nextDueDate",
             frequency, amount_minor::text AS "amountMinor", currency, auto_renew AS "autoRenew",
             version, created_at AS "createdAt"
      FROM crm.subscriptions
      WHERE tenant_id = ${ctx.tenantId} ${contactFilter} ${productFilter} ${statusFilter}
      ORDER BY created_at DESC
      LIMIT ${q.limit} OFFSET ${q.offset}
    `))) as unknown as Array<Record<string, unknown>>;
    return reply.send({ data: rows, meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total: rows.length } });
  });

  app.patch("/v1/crm/subscriptions/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = patchBody.parse(req.body);

    if (Object.keys(body).length === 0) {
      throw new HttpError(400, "EMPTY_BODY", "at least one field must be provided");
    }

    const result = (await scopedRead((tx) => tx.execute(sql`
      UPDATE crm.subscriptions
      SET status = COALESCE(${body.status ?? null}::varchar, status),
          auto_renew = COALESCE(${body.autoRenew ?? null}::boolean, auto_renew),
          next_due_date = COALESCE(${body.nextDueDate ?? null}::date, next_due_date),
          version = version + 1,
          updated_at = now()
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
      RETURNING id, status, version
    `))) as unknown as Array<Record<string, unknown>>;

    if (result.length === 0) {
      throw new HttpError(404, "NOT_FOUND", "subscription not found");
    }
    return reply.send({ data: result[0] });
  });

  // Upcoming dues
  app.get("/v1/crm/subscriptions/due", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = dueQuery.parse(req.query);

    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT id, tenant_id AS "tenantId", contact_id AS "contactId", product_id AS "productId",
             type, status, next_due_date AS "nextDueDate", frequency,
             amount_minor::text AS "amountMinor", currency
      FROM crm.subscriptions
      WHERE tenant_id = ${ctx.tenantId}
        AND status = 'active'
        AND next_due_date <= (CURRENT_DATE + ${q.days}::int)
        AND next_due_date >= CURRENT_DATE
      ORDER BY next_due_date ASC
    `))) as unknown as Array<Record<string, unknown>>;
    return reply.send({ data: rows, meta: { total: rows.length, daysAhead: q.days } });
  });
}
