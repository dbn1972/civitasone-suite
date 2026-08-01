/**
 * Strategic account plan routes (KA-001).
 * GET    /v1/crm/account-plans              — list (accountId / planYear / status filters)
 * POST   /v1/crm/account-plans              — create a draft plan
 * PATCH  /v1/crm/account-plans/:id          — amend objectives / white-space / risks
 * POST   /v1/crm/accounts/:id/plans/:planId/activate — promote draft → active
 * GET    /v1/crm/accounts/:id/plans         — plans for one account
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead, db } from "../../shared/db.js";
import { emitWithAudit } from "../../shared/route-audit.js";
import { listQuery, windowOf, listEnvelope } from "../../shared/list-query.js";
import { EVENTS } from "../../topics.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];
const ADMIN_ROLES = ["crm_admin", "super_admin", "tenant_admin"];
const RESOURCE = "account_plan";

const PLAN_STATUSES = ["draft", "active", "closed"] as const;

/** Plans are annual; the window guards against typos like 20226. */
const MIN_PLAN_YEAR = 2000;
const MAX_PLAN_YEAR = 2100;

const idParam = z.object({ id: z.string().uuid() });
const accountPlanParam = z.object({ id: z.string().uuid(), planId: z.string().uuid() });

const objectiveItem = z.object({
  title: z.string().min(1).max(300),
  metric: z.string().max(300).optional(),
  targetDate: z.string().max(40).optional(),
});

const whiteSpaceItem = z.object({
  productLine: z.string().min(1).max(200),
  rationale: z.string().max(1000).optional(),
});

const riskItem = z.object({
  description: z.string().min(1).max(1000),
  severity: z.enum(["low", "medium", "high"]).default("medium"),
  mitigation: z.string().max(1000).optional(),
});

const createPlanBody = z.object({
  accountId: z.string().uuid(),
  planYear: z.number().int().min(MIN_PLAN_YEAR).max(MAX_PLAN_YEAR),
  objectives: z.array(objectiveItem).max(100).default([]),
  whiteSpace: z.array(whiteSpaceItem).max(100).default([]),
  risks: z.array(riskItem).max(100).default([]),
  ownerId: z.string().uuid().optional(),
});

const updatePlanBody = z.object({
  objectives: z.array(objectiveItem).max(100).optional(),
  whiteSpace: z.array(whiteSpaceItem).max(100).optional(),
  risks: z.array(riskItem).max(100).optional(),
  status: z.enum(PLAN_STATUSES).optional(),
  ownerId: z.string().uuid().optional(),
  version: z.number().int().min(1).optional(),
}).refine(
  (b) => b.objectives !== undefined || b.whiteSpace !== undefined || b.risks !== undefined
    || b.status !== undefined || b.ownerId !== undefined,
  { message: "at least one mutable field is required" },
);

const listPlansQuery = listQuery.extend({
  accountId: z.string().uuid().optional(),
  planYear: z.coerce.number().int().min(MIN_PLAN_YEAR).max(MAX_PLAN_YEAR).optional(),
  status: z.enum(PLAN_STATUSES).optional(),
});

const SELECT_COLUMNS = sql`
  id,
  account_id   AS "accountId",
  plan_year    AS "planYear",
  objectives,
  white_space  AS "whiteSpace",
  risks,
  status,
  owner_id     AS "ownerId",
  created_at   AS "createdAt",
  updated_at   AS "updatedAt",
  version
`;

type PlanRow = Record<string, unknown>;

export async function planRoutes(app: FastifyInstance): Promise<void> {
  /** List account plans with optional filters. */
  app.get("/v1/crm/account-plans", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = listPlansQuery.parse(req.query ?? {});
    const w = windowOf(q);

    const accountFilter = q.accountId ? sql`AND account_id = ${q.accountId}` : sql``;
    const yearFilter = q.planYear !== undefined ? sql`AND plan_year = ${q.planYear}` : sql``;
    const statusFilter = q.status ? sql`AND status = ${q.status}` : sql``;

    const { rows, total } = await scopedRead(async (tx) => {
      const data = await tx.execute(sql`
        SELECT ${SELECT_COLUMNS}
        FROM crm.account_plans
        WHERE tenant_id = ${ctx.tenantId} ${accountFilter} ${yearFilter} ${statusFilter}
        ORDER BY plan_year DESC, created_at DESC
        LIMIT ${w.pageSize} OFFSET ${w.offset}
      `) as unknown as PlanRow[];
      const counted = await tx.execute(sql`
        SELECT count(*)::int AS total
        FROM crm.account_plans
        WHERE tenant_id = ${ctx.tenantId} ${accountFilter} ${yearFilter} ${statusFilter}
      `) as unknown as Array<{ total: number }>;
      return { rows: data, total: counted[0]?.total ?? 0 };
    });

    return reply.send(listEnvelope(rows, w, total));
  });

  /** Plans belonging to a single account. */
  app.get("/v1/crm/accounts/:id/plans", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const q = listQuery.parse(req.query ?? {});
    const w = windowOf(q);

    const { rows, total } = await scopedRead(async (tx) => {
      const data = await tx.execute(sql`
        SELECT ${SELECT_COLUMNS}
        FROM crm.account_plans
        WHERE tenant_id = ${ctx.tenantId} AND account_id = ${id}
        ORDER BY plan_year DESC
        LIMIT ${w.pageSize} OFFSET ${w.offset}
      `) as unknown as PlanRow[];
      const counted = await tx.execute(sql`
        SELECT count(*)::int AS total
        FROM crm.account_plans
        WHERE tenant_id = ${ctx.tenantId} AND account_id = ${id}
      `) as unknown as Array<{ total: number }>;
      return { rows: data, total: counted[0]?.total ?? 0 };
    });

    return reply.send(listEnvelope(rows, w, total));
  });

  /** Create a draft plan for an account/year. */
  app.post("/v1/crm/account-plans", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const body = createPlanBody.parse(req.body);

    const existing = await scopedRead(async (tx) => {
      return tx.execute(sql`
        SELECT id FROM crm.account_plans
        WHERE tenant_id = ${ctx.tenantId} AND account_id = ${body.accountId} AND plan_year = ${body.planYear}
      `) as unknown as Array<{ id: string }>;
    });
    if (existing.length > 0) {
      throw new HttpError(409, "PLAN_EXISTS", "a plan already exists for this account and year");
    }

    const planId = randomUUID();
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO crm.account_plans
          (id, tenant_id, account_id, plan_year, objectives, white_space, risks,
           status, owner_id, created_by, updated_by)
        VALUES (
          ${planId}, ${ctx.tenantId}, ${body.accountId}, ${body.planYear},
          ${JSON.stringify(body.objectives)}::jsonb,
          ${JSON.stringify(body.whiteSpace)}::jsonb,
          ${JSON.stringify(body.risks)}::jsonb,
          'draft', ${body.ownerId ?? null}, ${ctx.actorId}, ${ctx.actorId}
        )
      `);
      await emitWithAudit(tx, ctx, {
        eventType: EVENTS.accountPlanCreated,
        action: "create",
        resourceType: RESOURCE,
        resourceId: planId,
        payload: { planId, accountId: body.accountId, planYear: body.planYear },
      });
    });

    return reply.code(201).send({
      data: {
        id: planId,
        accountId: body.accountId,
        planYear: body.planYear,
        objectives: body.objectives,
        whiteSpace: body.whiteSpace,
        risks: body.risks,
        status: "draft",
        ownerId: body.ownerId ?? null,
        version: 1,
      },
    });
  });

  /** Amend a plan. Optimistic locking: a stale `version` yields 409. */
  app.patch("/v1/crm/account-plans/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updatePlanBody.parse(req.body);

    const current = await scopedRead(async (tx) => {
      return tx.execute(sql`
        SELECT id, version FROM crm.account_plans
        WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
      `) as unknown as Array<{ id: string; version: number }>;
    });
    if (current.length === 0) {
      throw new HttpError(404, "NOT_FOUND", "account plan not found");
    }

    const sets = [
      body.objectives !== undefined ? sql`objectives = ${JSON.stringify(body.objectives)}::jsonb` : null,
      body.whiteSpace !== undefined ? sql`white_space = ${JSON.stringify(body.whiteSpace)}::jsonb` : null,
      body.risks !== undefined ? sql`risks = ${JSON.stringify(body.risks)}::jsonb` : null,
      body.status !== undefined ? sql`status = ${body.status}` : null,
      body.ownerId !== undefined ? sql`owner_id = ${body.ownerId}` : null,
    ].filter((s): s is NonNullable<typeof s> => s !== null);

    const versionGuard = body.version !== undefined ? sql`AND version = ${body.version}` : sql``;

    const updated = await db.transaction(async (tx) => {
      const rows = await tx.execute(sql`
        UPDATE crm.account_plans
        SET ${sql.join(sets, sql`, `)}, updated_at = now(), updated_by = ${ctx.actorId}, version = version + 1
        WHERE id = ${id} AND tenant_id = ${ctx.tenantId} ${versionGuard}
        RETURNING id, version
      `) as unknown as Array<{ id: string; version: number }>;
      if (rows.length === 0) return rows;
      await emitWithAudit(tx, ctx, {
        eventType: EVENTS.accountPlanUpdated,
        action: "update",
        resourceType: RESOURCE,
        resourceId: id,
        payload: { planId: id, changed: Object.keys(body).filter((k) => k !== "version") },
      });
      return rows;
    });

    const row = updated[0];
    if (!row) {
      throw new HttpError(409, "VERSION_CONFLICT", "account plan was modified by another request");
    }

    return reply.send({ data: { id, version: row.version } });
  });

  /**
   * Activate a plan. Only a draft can be activated, and activating one plan
   * closes nothing else automatically — the unique (account, year) constraint
   * already guarantees there is only one plan per year to activate.
   */
  app.post("/v1/crm/accounts/:id/plans/:planId/activate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id: accountId, planId } = accountPlanParam.parse(req.params);

    const found = await scopedRead(async (tx) => {
      return tx.execute(sql`
        SELECT id, status, version FROM crm.account_plans
        WHERE id = ${planId} AND account_id = ${accountId} AND tenant_id = ${ctx.tenantId}
      `) as unknown as Array<{ id: string; status: string; version: number }>;
    });

    const plan = found[0];
    if (!plan) {
      throw new HttpError(404, "NOT_FOUND", "account plan not found for this account");
    }
    if (plan.status !== "draft") {
      throw new HttpError(422, "INVALID_STATE", `cannot activate a plan in status '${plan.status}'`);
    }

    const updated = await db.transaction(async (tx) => {
      const rows = await tx.execute(sql`
        UPDATE crm.account_plans
        SET status = 'active', updated_at = now(), updated_by = ${ctx.actorId}, version = version + 1
        WHERE id = ${planId} AND tenant_id = ${ctx.tenantId} AND version = ${plan.version}
        RETURNING id, version
      `) as unknown as Array<{ id: string; version: number }>;
      if (rows.length === 0) return rows;
      await emitWithAudit(tx, ctx, {
        eventType: EVENTS.accountPlanActivated,
        action: "activate",
        resourceType: RESOURCE,
        resourceId: planId,
        payload: { planId, accountId },
      });
      return rows;
    });

    const row = updated[0];
    if (!row) {
      throw new HttpError(409, "VERSION_CONFLICT", "account plan was modified by another request");
    }

    return reply.send({ data: { id: planId, accountId, status: "active", version: row.version } });
  });
}
