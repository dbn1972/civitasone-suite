/**
 * Mandatory next-action routes (AC-002).
 * POST /v1/crm/next-actions              — schedule the next step on a lead/deal
 * GET  /v1/crm/next-actions              — list (subjectType / subjectId / overdue filters)
 * GET  /v1/crm/next-actions/compliance   — active leads & open deals with NO open next step
 * POST /v1/crm/next-actions/:id/complete — mark done
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
import { requiresNextAction, isOverdue } from "./next-action-domain.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];
const RESOURCE = "next_action";

const SUBJECT_TYPES = ["contact", "deal"] as const;

const idParam = z.object({ id: z.string().uuid() });

const createBody = z.object({
  subjectType: z.enum(SUBJECT_TYPES),
  subjectId: z.string().uuid(),
  actionType: z.string().min(1).max(40),
  dueAt: z.string().datetime(),
  notes: z.string().max(2000).optional(),
});

const listNextActionsQuery = listQuery.extend({
  subjectType: z.enum(SUBJECT_TYPES).optional(),
  subjectId: z.string().uuid().optional(),
  /** `overdue=true` narrows to open actions whose due date has passed. */
  overdue: z.enum(["true", "false"]).optional(),
});

const complianceQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

const SELECT_COLUMNS = sql`
  id,
  subject_type  AS "subjectType",
  subject_id    AS "subjectId",
  action_type   AS "actionType",
  due_at        AS "dueAt",
  notes,
  completed_at  AS "completedAt",
  created_at    AS "createdAt",
  updated_at    AS "updatedAt",
  version
`;

type ActionRow = Record<string, unknown>;

export async function nextActionRoutes(app: FastifyInstance): Promise<void> {
  /** Schedule a next action. */
  app.post("/v1/crm/next-actions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const body = createBody.parse(req.body);

    const actionId = randomUUID();
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO crm.next_actions
          (id, tenant_id, subject_type, subject_id, action_type, due_at, notes, created_by, updated_by)
        VALUES (
          ${actionId}, ${ctx.tenantId}, ${body.subjectType}, ${body.subjectId},
          ${body.actionType}, ${body.dueAt}::timestamptz, ${body.notes ?? null},
          ${ctx.actorId}, ${ctx.actorId}
        )
      `);
      await emitWithAudit(tx, ctx, {
        eventType: EVENTS.nextActionCreated,
        action: "create",
        resourceType: RESOURCE,
        resourceId: actionId,
        payload: {
          actionId,
          subjectType: body.subjectType,
          subjectId: body.subjectId,
          actionType: body.actionType,
          dueAt: body.dueAt,
        },
      });
    });

    return reply.code(201).send({
      data: {
        id: actionId,
        subjectType: body.subjectType,
        subjectId: body.subjectId,
        actionType: body.actionType,
        dueAt: body.dueAt,
        notes: body.notes ?? null,
        completedAt: null,
        version: 1,
      },
    });
  });

  /** List next actions. */
  app.get("/v1/crm/next-actions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = listNextActionsQuery.parse(req.query ?? {});
    const w = windowOf(q);

    const typeFilter = q.subjectType ? sql`AND subject_type = ${q.subjectType}` : sql``;
    const subjectFilter = q.subjectId ? sql`AND subject_id = ${q.subjectId}` : sql``;
    const overdueFilter = q.overdue === "true"
      ? sql`AND completed_at IS NULL AND due_at < now()`
      : sql``;

    const { rows, total } = await scopedRead(async (tx) => {
      const data = await tx.execute(sql`
        SELECT ${SELECT_COLUMNS}
        FROM crm.next_actions
        WHERE tenant_id = ${ctx.tenantId} ${typeFilter} ${subjectFilter} ${overdueFilter}
        ORDER BY due_at ASC
        LIMIT ${w.pageSize} OFFSET ${w.offset}
      `) as unknown as ActionRow[];
      const counted = await tx.execute(sql`
        SELECT count(*)::int AS total
        FROM crm.next_actions
        WHERE tenant_id = ${ctx.tenantId} ${typeFilter} ${subjectFilter} ${overdueFilter}
      `) as unknown as Array<{ total: number }>;
      return { rows: data, total: counted[0]?.total ?? 0 };
    });

    const now = new Date();
    const enriched = rows.map((r) => ({
      ...r,
      overdue: r["completedAt"] === null && isOverdue(r["dueAt"] as string | Date, now),
    }));

    return reply.send(listEnvelope(enriched, w, total));
  });

  /**
   * AC-002 enforcement report: subjects that SHOULD carry an open next action but
   * do not. The "should" decision uses the pure `requiresNextAction` policy so
   * the rule lives in one testable place instead of being spread across SQL.
   */
  app.get("/v1/crm/next-actions/compliance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = complianceQuery.parse(req.query ?? {});

    const candidates = await scopedRead(async (tx) => {
      return tx.execute(sql`
        SELECT 'contact' AS "subjectType", c.id AS "subjectId", c.name AS label,
               c.lead_status AS "subjectStatus", c.owner_id AS "ownerId"
        FROM crm.contacts c
        WHERE c.tenant_id = ${ctx.tenantId}
          AND c.status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM crm.next_actions na
            WHERE na.tenant_id = c.tenant_id
              AND na.subject_type = 'contact'
              AND na.subject_id = c.id
              AND na.completed_at IS NULL
          )
        UNION ALL
        SELECT 'deal' AS "subjectType", d.id AS "subjectId", d.name AS label,
               d.stage AS "subjectStatus", d.owner_id AS "ownerId"
        FROM crm.deals d
        WHERE d.tenant_id = ${ctx.tenantId}
          AND d.status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM crm.next_actions na
            WHERE na.tenant_id = d.tenant_id
              AND na.subject_type = 'deal'
              AND na.subject_id = d.id
              AND na.completed_at IS NULL
          )
        LIMIT ${q.limit}
      `) as unknown as Array<{
        subjectType: string;
        subjectId: string;
        label: string | null;
        subjectStatus: string | null;
        ownerId: string | null;
      }>;
    });

    const nonCompliant = candidates.filter((c) => requiresNextAction(c.subjectStatus));
    const contacts = nonCompliant.filter((c) => c.subjectType === "contact").length;
    const deals = nonCompliant.length - contacts;

    return reply.send({
      data: nonCompliant,
      meta: {
        page: 1,
        pageSize: q.limit,
        total: nonCompliant.length,
        missingByType: { contact: contacts, deal: deals },
      },
    });
  });

  /** Complete an action. Completing twice is rejected rather than silently ignored. */
  app.post("/v1/crm/next-actions/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);

    const found = await scopedRead(async (tx) => {
      return tx.execute(sql`
        SELECT id, completed_at AS "completedAt", version FROM crm.next_actions
        WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
      `) as unknown as Array<{ id: string; completedAt: Date | null; version: number }>;
    });
    const action = found[0];
    if (!action) {
      throw new HttpError(404, "NOT_FOUND", "next action not found");
    }
    if (action.completedAt !== null) {
      throw new HttpError(422, "ALREADY_COMPLETED", "next action is already completed");
    }

    const updated = await db.transaction(async (tx) => {
      const rows = await tx.execute(sql`
        UPDATE crm.next_actions
        SET completed_at = now(), updated_at = now(), updated_by = ${ctx.actorId}, version = version + 1
        WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND version = ${action.version}
        RETURNING id, version, completed_at AS "completedAt"
      `) as unknown as Array<{ id: string; version: number; completedAt: Date }>;
      if (rows.length === 0) return rows;
      await emitWithAudit(tx, ctx, {
        eventType: EVENTS.nextActionCompleted,
        action: "complete",
        resourceType: RESOURCE,
        resourceId: id,
        payload: { actionId: id },
      });
      return rows;
    });

    const row = updated[0];
    if (!row) {
      throw new HttpError(409, "VERSION_CONFLICT", "next action was modified by another request");
    }

    return reply.send({ data: { id, completedAt: row.completedAt, version: row.version } });
  });
}
