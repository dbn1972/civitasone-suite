import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError, financeErrorHandler } from "../../shared/context.js";
import * as repo from "./repo.js";
import { requestAuditParaTransition, listAuditParaEvents, type ParaAction } from "./commands.js";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { AuditParaRow } from "./schema.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];
const READER_ROLES  = [...FINANCE_ROLES, "audit_officer"];

// Status values per the enforced DB check constraint (migrations/0036_check_constraints_status_columns.sql):
// finance_audit_paras_status_check CHECK (status IN ('open','responded','settled','escalated','dropped')).
const listAuditParasQuery = z.object({
  status: z.enum(["open", "responded", "settled", "escalated", "dropped"]).optional(),
  // No DB check constraint on source (only the CAG|AG|internal convention noted in schema.ts); bound
  // it to the column's varchar(32) length instead of guessing an enum that could reject valid data.
  source: z.string().min(1).max(32).optional(),
  limit:  z.coerce.number().int().positive().max(200).default(50),
});

const idParam = z.object({ id: z.string().uuid() });
/** Recording a reply / escalating is finance work; settling a para (closing it) is admin-only. */
const SETTLE_ROLES = ["finance_admin", "super_admin"];
const noteBody = z.object({ note: z.string().trim().min(5).max(2000) });

/**
 * Shape a DB row onto the wire contract already declared in
 * packages/schemas/src/web.ts (FinanceAuditParaSummarySchema) and consumed by
 * apps/web's audit-paras loaders/pages. money_value_minor is bigint at the
 * DB/Drizzle layer and must become a string — JSON has no bigint type.
 */
function serialize(row: AuditParaRow) {
  return {
    id: row.id,
    paraNo: row.paraNo,
    source: row.source,
    dept: row.dept,
    departmentId: row.departmentId,
    moneyValueMinor: row.moneyValueMinor.toString(),
    currency: row.currency,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}

/**
 * CAG/AG/internal audit paragraphs — tenant-scoped, read-only listing and
 * detail lookup. finance_audit_paras has no observation/reply/action-taken
 * narrative columns yet; only the real columns are served, and the frontend
 * detail page already falls back gracefully when those keys are absent.
 */
export async function auditRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/finance/audit-paras", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listAuditParasQuery.parse(req.query);
    const rows = await repo.listAuditParas(ctx.tenantId, {
      limit: q.limit,
      ...(q.status ? { status: q.status } : {}),
      ...(q.source ? { source: q.source } : {}),
    });
    const data = rows.map(serialize);
    return reply.send({ data, pagination: { hasMore: data.length === q.limit, pageSize: q.limit } });
  });

  app.get("/v1/finance/audit-paras/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await repo.getAuditParaById(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "audit para not found");
    return reply.send(serialize(row));
  });

  // GAP-FINANCE-AUDIT-PARAS-DETAIL-04: the reply / escalate / settle trail for one para.
  app.get("/v1/finance/audit-paras/:id/events", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    if (!(await repo.getAuditParaById(ctx.tenantId, id))) throw new HttpError(404, "NOT_FOUND", "audit para not found");
    const rows = await listAuditParaEvents(ctx.tenantId, id);
    return reply.send({
      data: rows.map((e) => ({
        id: e.id, action: e.action, fromStatus: e.fromStatus, toStatus: e.toStatus,
        note: e.note, actorId: e.actorId, createdAt: e.createdAt,
      })),
    });
  });

  for (const action of ["respond", "escalate", "settle"] as ParaAction[]) {
    app.post(`/v1/finance/audit-paras/:id/${action}`, async (req, reply) => {
      const ctx = resolveContext(req);
      requireRole(ctx, action === "settle" ? SETTLE_ROLES : FINANCE_ROLES);
      const { id } = idParam.parse(req.params);
      const body = noteBody.parse(req.body);
      return sendAccepted(reply, acceptedResponseSchema, await requestAuditParaTransition(ctx, id, action, body.note));
    });
  }

  app.setErrorHandler(financeErrorHandler);
}
