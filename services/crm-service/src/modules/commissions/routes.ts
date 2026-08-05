import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";

const ADMIN_ROLES = ["crm_admin", "super_admin"];
const CRM_ROLES = ["crm_user", "crm_admin", "super_admin"];

const createRuleBody = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(["referral", "sale", "renewal"]),
  rateType: z.enum(["percentage", "fixed"]),
  rateValue: z.number().int().min(0),
  conditions: z.record(z.unknown()).default({}),
  enabled: z.boolean().default(true),
});

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  type: z.enum(["referral", "sale", "renewal"]).optional(),
});

const ledgerQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  agentId: z.string().uuid().optional(),
  period: z.string().optional(),
  status: z.enum(["pending", "approved", "paid", "disputed"]).optional(),
});

const summaryQuery = z.object({
  agentId: z.string().uuid().optional(),
  period: z.string().optional(),
});

const idParam = z.object({ id: z.string().uuid() });

export async function commissionRoutes(app: FastifyInstance): Promise<void> {
  // Admin CRUD — commission rules
  app.post("/v1/crm/commission-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createRuleBody.parse(req.body);
    const rows = (await scopedRead((tx) => tx.execute(sql`
      INSERT INTO crm.commission_rules (tenant_id, name, type, rate_type, rate_value, conditions, enabled, created_by)
      VALUES (${ctx.tenantId}, ${body.name}, ${body.type}, ${body.rateType}, ${body.rateValue},
              ${JSON.stringify(body.conditions)}::jsonb, ${body.enabled}, ${ctx.actorId})
      RETURNING id, tenant_id AS "tenantId", name, type, rate_type AS "rateType",
                rate_value::text AS "rateValue", conditions, enabled, version,
                created_at AS "createdAt"
    `))) as unknown as Array<Record<string, unknown>>;
    return reply.code(201).send({ data: rows[0] });
  });

  app.get("/v1/crm/commission-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const q = listQuery.parse(req.query);
    const typeFilter = q.type ? sql`AND type = ${q.type}` : sql``;
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT id, tenant_id AS "tenantId", name, type, rate_type AS "rateType",
             rate_value::text AS "rateValue", conditions, enabled, version,
             created_at AS "createdAt"
      FROM crm.commission_rules
      WHERE tenant_id = ${ctx.tenantId} ${typeFilter}
      ORDER BY created_at DESC
      LIMIT ${q.limit} OFFSET ${q.offset}
    `))) as unknown as Array<Record<string, unknown>>;
    return reply.send({ data: rows, meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total: rows.length } });
  });

  // Ledger entries
  app.get("/v1/crm/commissions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = ledgerQuery.parse(req.query);
    const agentFilter = q.agentId ? sql`AND agent_id = ${q.agentId}` : sql``;
    const periodFilter = q.period ? sql`AND period = ${q.period}` : sql``;
    const statusFilter = q.status ? sql`AND status = ${q.status}` : sql``;
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT id, tenant_id AS "tenantId", agent_id AS "agentId", deal_id AS "dealId",
             rule_id AS "ruleId", amount_minor::text AS "amountMinor", currency, status,
             period, created_at AS "createdAt", approved_by AS "approvedBy", paid_at AS "paidAt"
      FROM crm.commission_ledger
      WHERE tenant_id = ${ctx.tenantId} ${agentFilter} ${periodFilter} ${statusFilter}
      ORDER BY created_at DESC
      LIMIT ${q.limit} OFFSET ${q.offset}
    `))) as unknown as Array<Record<string, unknown>>;
    return reply.send({ data: rows, meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total: rows.length } });
  });

  // Approve a commission entry
  app.post("/v1/crm/commissions/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const result = (await scopedRead((tx) => tx.execute(sql`
      UPDATE crm.commission_ledger
      SET status = 'approved', approved_by = ${ctx.actorId}
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND status = 'pending'
      RETURNING id
    `))) as unknown as Array<Record<string, unknown>>;
    if (result.length === 0) throw new HttpError(404, "NOT_FOUND", "commission entry not found or already processed");
    return reply.send({ data: { id, status: "approved" } });
  });

  // Summary by agent/period
  app.get("/v1/crm/commissions/summary", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = summaryQuery.parse(req.query);
    const agentFilter = q.agentId ? sql`AND agent_id = ${q.agentId}` : sql``;
    const periodFilter = q.period ? sql`AND period = ${q.period}` : sql``;
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT agent_id AS "agentId", period,
             SUM(amount_minor)::text AS "totalMinor",
             COUNT(*)::int AS "count",
             COUNT(*) FILTER (WHERE status = 'pending')::int AS "pendingCount",
             COUNT(*) FILTER (WHERE status = 'approved')::int AS "approvedCount",
             COUNT(*) FILTER (WHERE status = 'paid')::int AS "paidCount"
      FROM crm.commission_ledger
      WHERE tenant_id = ${ctx.tenantId} ${agentFilter} ${periodFilter}
      GROUP BY agent_id, period
      ORDER BY period DESC, agent_id
    `))) as unknown as Array<Record<string, unknown>>;
    return reply.send({ data: rows });
  });
}
