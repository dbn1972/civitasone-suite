import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError, financeErrorHandler } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./formulation-repo.js";
import {
  assertProposalValid, consolidateProposals, ceilingBreachMinor,
} from "./formulation-domain.js";
import { DomainError } from "./domain.js";
import {
  createProposalBody, reviewProposalBody, reviseProposalBody,
  proposalQuery, consolidationQuery, idParam,
} from "./formulation-validators.js";
import type { BudgetProposalRow } from "./formulation-schema.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];
const READER_ROLES = [...FINANCE_ROLES, "audit_officer"];
const APPROVER_ROLES = ["finance_admin", "super_admin"];

function toDomain(err: unknown, status = 400): never {
  if (err instanceof DomainError) throw new HttpError(status, err.code, err.message);
  throw err;
}

export async function budgetFormulationRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/finance/budget-proposals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const body = createProposalBody.parse(req.body);
    try {
      assertProposalValid({
        ceilingMinor: BigInt(body.ceilingMinor),
        proposedMinor: BigInt(body.proposedMinor),
        justification: body.justification,
      });
    } catch (err) { toDomain(err); }
    const id = randomUUID();
    await queue.publish(COMMANDS.budgetProposalCreate, {
      messageId: id, type: COMMANDS.budgetProposalCreate,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId, ...body },
    });
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });

  app.get("/v1/finance/budget-proposals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = proposalQuery.parse(req.query);
    const rows = await repo.listProposals(ctx.tenantId, { fy: q.fy, deptCode: q.deptCode, status: q.status }, q.limit);
    return reply.send({ data: rows.map(serialize) });
  });

  app.get("/v1/finance/budget-proposals/consolidation", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = consolidationQuery.parse(req.query);
    const rows = await repo.listApprovedForConsolidation(ctx.tenantId, q.fy);
    const c = consolidateProposals(rows.map((r) => ({ ceilingMinor: r.ceilingMinor, proposedMinor: r.proposedMinor })));
    return reply.send({
      fy: q.fy, count: c.count,
      totalCeilingMinor: c.totalCeilingMinor.toString(),
      totalProposedMinor: c.totalProposedMinor.toString(),
      totalBreachMinor: c.totalBreachMinor.toString(),
      lines: rows.map(serialize),
    });
  });

  app.get("/v1/finance/budget-proposals/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await repo.findProposalById(id, ctx.tenantId);
    if (!row) throw new HttpError(404, "NOT_FOUND", "proposal not found");
    return reply.send({ data: serialize(row) });
  });

  app.patch("/v1/finance/budget-proposals/:id/submit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = idParam.parse(req.params);
    await queue.publish(COMMANDS.budgetProposalSubmit, {
      messageId: randomUUID(), type: COMMANDS.budgetProposalSubmit,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId },
    });
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });

  app.patch("/v1/finance/budget-proposals/:id/review", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPROVER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = reviewProposalBody.parse(req.body);
    await queue.publish(COMMANDS.budgetProposalReview, {
      messageId: randomUUID(), type: COMMANDS.budgetProposalReview,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId, decision: body.decision, note: body.note },
    });
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });

  app.post("/v1/finance/budget-proposals/:id/revise", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = reviseProposalBody.parse(req.body);
    const newId = randomUUID();
    await queue.publish(COMMANDS.budgetProposalRevise, {
      messageId: newId, type: COMMANDS.budgetProposalRevise,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: {
        id: newId, tenantId: ctx.tenantId, parentId: id,
        proposedMinor: body.proposedMinor, ceilingMinor: body.ceilingMinor,
        justification: body.justification,
      },
    });
    return reply.code(202).send({ data: { id: newId, status: "accepted" } });
  });

  app.patch("/v1/finance/budget-proposals/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPROVER_ROLES);
    const { id } = idParam.parse(req.params);
    await queue.publish(COMMANDS.budgetProposalApprove, {
      messageId: randomUUID(), type: COMMANDS.budgetProposalApprove,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId },
    });
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });

  app.setErrorHandler(financeErrorHandler);
}

function serialize(r: BudgetProposalRow) {
  return {
    id: r.id, fy: r.fy, deptCode: r.deptCode, headId: r.headId,
    ceilingMinor: r.ceilingMinor.toString(),
    proposedMinor: r.proposedMinor.toString(),
    breachMinor: ceilingBreachMinor(r.ceilingMinor, r.proposedMinor).toString(),
    currency: r.currency, justification: r.justification, status: r.status,
    parentId: r.parentId, version: r.version, reviewNote: r.reviewNote,
    reviewedBy: r.reviewedBy, approvedBy: r.approvedBy, effectiveFrom: r.effectiveFrom,
  };
}
