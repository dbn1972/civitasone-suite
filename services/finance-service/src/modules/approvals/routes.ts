/**
 * Maker-checker change requests + per-tenant finance settings.
 *
 * Writes only publish commands (consumer.ts performs them in a transaction with
 * an audit event). Reads are tenant-scoped.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError, financeErrorHandler } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { submitChangeRequest } from "./commands.js";
import { scopedRead } from "../../shared/db.js";
import type { FinanceSettings } from "./domain.js";
import { alwaysDistinctApprover, assertDebtHeadsValid, assertDistinctApprover, CHANGE_REQUEST_KINDS, configuredDebtHeads, DomainError, isRelaxingControl } from "./domain.js";
import type { ChangeRequestRow } from "./schema.js";

const READER_ROLES = ["finance_officer", "finance_admin", "super_admin", "audit_officer"];
const DECIDER_ROLES = ["finance_admin", "super_admin"];

const idParam = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  kind: z.enum(CHANGE_REQUEST_KINDS).optional(),
  status: z.enum(["pending", "approved", "rejected", "cancelled"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
const decideBody = z.object({ note: z.string().trim().max(500).optional() });
const rejectBody = z.object({ note: z.string().trim().min(5, "Say why this is rejected (at least 5 characters)").max(500) });
const settingsBody = z.object({
  makerCheckerEnabled: z.boolean().optional(),
  blockFyActivationOpenPeriods: z.boolean().optional(),
  requireOpeningBalancesForActivation: z.boolean().optional(),
  fyCreateAsDraft: z.boolean().optional(),
  debtLoanLiabilityHeadId: z.string().uuid().nullable().optional(),
  debtInterestExpenseHeadId: z.string().uuid().nullable().optional(),
  debtBankHeadId: z.string().uuid().nullable().optional(),
  reason: z.string().trim().min(10, "Reason must be at least 10 characters").max(500),
}).refine((b) => Object.entries(b).some(([k, v]) => k !== "reason" && v !== undefined), { message: "no setting supplied" });

function view(r: ChangeRequestRow) {
  return {
    id: r.id, kind: r.kind, subjectKey: r.subjectKey, payload: r.payload, reason: r.reason, status: r.status,
    requestedBy: r.requestedBy, requestedAt: r.requestedAt.toISOString(),
    decidedBy: r.decidedBy, decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    decisionNote: r.decisionNote, version: r.version,
  };
}

export async function approvalsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/finance/settings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    return reply.send(await repo.readSettings(ctx.tenantId));
  });

  app.put("/v1/finance/settings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, DECIDER_ROLES);
    const body = settingsBody.parse(req.body);
    const { reason, ...changes } = body;
    // exactOptionalPropertyTypes: drop undefined keys
    const defined = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)) as Partial<FinanceSettings>;
    const current = await repo.readSettings(ctx.tenantId);

    // GL heads: the merged set must be all-or-none and valid (exist, right type, distinct).
    const merged = { ...current, ...defined };
    const anyHead = merged.debtLoanLiabilityHeadId || merged.debtInterestExpenseHeadId || merged.debtBankHeadId;
    if (anyHead) {
      const heads = configuredDebtHeads(merged);
      if (!heads) throw new HttpError(400, "GL_HEADS_INCOMPLETE", "set all three debt GL heads (loan liability, interest expense, bank) together");
      try {
        assertDebtHeadsValid(heads, await scopedRead((tx) => repo.headTypesTx(tx, ctx.tenantId, [heads.loanLiability, heads.interestExpense, heads.bank])));
      } catch (err) {
        if (err instanceof DomainError) throw new HttpError(400, err.code, err.message);
        throw err;
      }
    }

    // Switching a control OFF is itself held for a DIFFERENT admin (turning one ON stays direct), so a single
    // admin cannot disable the second-approver rule and then act alone.
    if (isRelaxingControl(current, defined)) {
      return reply.code(202).send(await submitChangeRequest(ctx, "settings_relax", "settings", { changes: defined }, reason));
    }
    const id = randomUUID();
    await queue.publish(COMMANDS.financeSettingsUpdate, {
      messageId: id, type: COMMANDS.financeSettingsUpdate,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId, changes: defined, reason },
    });
    return reply.code(202).send({ id, status: "accepted" });
  });

  app.get("/v1/finance/change-requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuery.parse(req.query);
    const { rows, total } = await repo.listChangeRequests(ctx.tenantId, { kind: q.kind, status: q.status }, q.limit, q.offset);
    return reply.send({ data: rows.map(view), total, limit: q.limit, offset: q.offset });
  });

  app.get("/v1/finance/change-requests/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await repo.findChangeRequest(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "change request not found");
    return reply.send(view(row));
  });

  for (const decision of ["approve", "reject"] as const) {
    app.post(`/v1/finance/change-requests/:id/${decision}`, async (req, reply) => {
      const ctx = resolveContext(req);
      requireRole(ctx, DECIDER_ROLES);
      const { id } = idParam.parse(req.params);
      const body = decision === "reject" ? rejectBody.parse(req.body ?? {}) : decideBody.parse(req.body ?? {});
      const row = await repo.findChangeRequest(ctx.tenantId, id);
      if (!row) throw new HttpError(404, "NOT_FOUND", "change request not found");
      if (row.status !== "pending") throw new HttpError(409, "NOT_PENDING", `change request is already ${row.status}`);
      const settings = await repo.readSettings(ctx.tenantId);
      try {
        assertDistinctApprover(row.requestedBy, ctx.actorId, settings.makerCheckerEnabled || alwaysDistinctApprover(row.kind));
      } catch (err) {
        if (err instanceof DomainError) throw new HttpError(409, err.code, err.message);
        throw err;
      }
      return reply.code(202).send(await commands.decideChangeRequest(ctx, id, decision, body.note ?? null));
    });
  }

  app.post("/v1/finance/change-requests/:id/cancel", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES.filter((r) => r !== "audit_officer"));
    const { id } = idParam.parse(req.params);
    const row = await repo.findChangeRequest(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "change request not found");
    if (row.status !== "pending") throw new HttpError(409, "NOT_PENDING", `change request is already ${row.status}`);
    if (row.requestedBy !== ctx.actorId) throw new HttpError(403, "FORBIDDEN", "only the officer who raised a change can withdraw it");
    return reply.code(202).send(await commands.decideChangeRequest(ctx, id, "cancel", null));
  });

  app.setErrorHandler(financeErrorHandler);
}
