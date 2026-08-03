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
import { sql } from "drizzle-orm";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { commandId } from "../../shared/idempotency.js";
import { scopedRead } from "../../shared/db.js";
import { COMMANDS } from "../../topics.js";
import { publishCrmCommand } from "../../shared/residual-publish.js";
import { listQuery, windowOf, listEnvelope } from "../../shared/list-query.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];
const ADMIN_ROLES = ["crm_admin", "super_admin", "tenant_admin"];
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

    const planId = commandId(ctx, COMMANDS.createAccountPlan);
    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await publishCrmCommand(ctx, COMMANDS.createAccountPlan, planId, {
        accountId: body.accountId,
        planYear: body.planYear,
        objectives: body.objectives,
        whiteSpace: body.whiteSpace,
        risks: body.risks,
        ownerId: body.ownerId ?? null,
      }),
    );
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
    const plan = current[0];
    if (!plan) {
      throw new HttpError(404, "NOT_FOUND", "account plan not found");
    }
    // The consumer's UPDATE is guarded on `version`, so a stale value there is a
    // silent no-op after a 202. Reject it here while the caller can still see it.
    if (body.version !== undefined && body.version !== plan.version) {
      throw new HttpError(
        409,
        "VERSION_CONFLICT",
        `account plan is at version ${plan.version}, not ${body.version}`,
      );
    }

    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await publishCrmCommand(ctx, COMMANDS.updateAccountPlan, id, {
        ...(body.objectives !== undefined ? { objectives: body.objectives } : {}),
        ...(body.whiteSpace !== undefined ? { whiteSpace: body.whiteSpace } : {}),
        ...(body.risks !== undefined ? { risks: body.risks } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.ownerId !== undefined ? { ownerId: body.ownerId } : {}),
        ...(body.version !== undefined ? { version: body.version } : {}),
        changed: Object.keys(body).filter((k) => k !== "version"),
      }),
    );
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

    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await publishCrmCommand(ctx, COMMANDS.activateAccountPlan, planId, {
        accountId,
        version: plan.version,
      }),
    );
  });
}
