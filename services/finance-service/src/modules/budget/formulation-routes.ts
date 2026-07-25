import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./formulation-repo.js";
import {
  assertProposalValid, assertProposalTransition, assertProposalApproverDistinct,
  consolidateProposals, nextVersion, ceilingBreachMinor,
  type ProposalStatus,
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
const AUDIT_TOPIC = "audit.event.record";

function toDomain(err: unknown, status = 400): never {
  if (err instanceof DomainError) throw new HttpError(status, err.code, err.message);
  throw err;
}

export async function budgetFormulationRoutes(app: FastifyInstance): Promise<void> {
  // Raise a departmental proposal (draft) against a ceiling.
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
    await db.transaction(async (tx) => {
      await repo.insertProposal(tx, {
        id, tenantId: ctx.tenantId, fy: body.fy, deptCode: body.deptCode, headId: body.headId,
        ceilingMinor: BigInt(body.ceilingMinor), proposedMinor: BigInt(body.proposedMinor),
        currency: body.currency, justification: body.justification, status: "draft",
        effectiveFrom: body.effectiveFrom ?? new Date().toISOString().slice(0, 10),
        createdBy: ctx.actorId, updatedBy: ctx.actorId,
      });
      await audit(tx, ctx, "create", id);
    });
    const row = await repo.findProposalById(id, ctx.tenantId);
    return reply.code(201).send({ data: serialize(row!) });
  });

  app.get("/v1/finance/budget-proposals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = proposalQuery.parse(req.query);
    const rows = await repo.listProposals(ctx.tenantId, { fy: q.fy, deptCode: q.deptCode, status: q.status }, q.limit);
    return reply.send({ data: rows.map(serialize) });
  });

  // Consolidation across heads for an FY (sum of approved proposals vs ceilings).
  app.get("/v1/finance/budget-proposals/consolidation", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = consolidationQuery.parse(req.query);
    const rows = await repo.listApprovedForConsolidation(ctx.tenantId, q.fy);
    const c = consolidateProposals(rows.map((r) => ({ ceilingMinor: r.ceilingMinor, proposedMinor: r.proposedMinor })));
    return reply.send({
      fy: q.fy,
      count: c.count,
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

  // Submit a draft/returned proposal for review.
  app.patch("/v1/finance/budget-proposals/:id/submit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = idParam.parse(req.params);
    await transition(ctx, id, "submitted", () => ({ status: "submitted", updatedBy: ctx.actorId }));
    const row = await repo.findProposalById(id, ctx.tenantId);
    return reply.send({ data: serialize(row!) });
  });

  // Reviewer accepts (→ under_review) or returns (→ returned) with a note.
  app.patch("/v1/finance/budget-proposals/:id/review", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPROVER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = reviewProposalBody.parse(req.body);
    const to: ProposalStatus = body.decision === "accept" ? "under_review" : "returned";
    await transition(ctx, id, to, () => ({
      status: to, reviewNote: body.note, reviewedBy: ctx.actorId, reviewedAt: new Date(), updatedBy: ctx.actorId,
    }));
    const row = await repo.findProposalById(id, ctx.tenantId);
    return reply.send({ data: serialize(row!) });
  });

  // Create a new VERSION of a returned proposal (revision chain via parent_id).
  app.post("/v1/finance/budget-proposals/:id/revise", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = reviseProposalBody.parse(req.body);
    const newId = randomUUID();
    await db.transaction(async (tx) => {
      const parent = await repo.findProposalByIdTx(tx, id, ctx.tenantId);
      if (!parent) throw new HttpError(404, "NOT_FOUND", "proposal not found");
      const ceiling = body.ceilingMinor !== undefined ? BigInt(body.ceilingMinor) : parent.ceilingMinor;
      try {
        assertProposalValid({ ceilingMinor: ceiling, proposedMinor: BigInt(body.proposedMinor), justification: body.justification });
      } catch (err) { toDomain(err); }
      await repo.insertProposal(tx, {
        id: newId, tenantId: ctx.tenantId, fy: parent.fy, deptCode: parent.deptCode, headId: parent.headId,
        ceilingMinor: ceiling, proposedMinor: BigInt(body.proposedMinor), currency: parent.currency,
        justification: body.justification, status: "draft", parentId: parent.id,
        effectiveFrom: parent.effectiveFrom, version: nextVersion(parent.version),
        createdBy: ctx.actorId, updatedBy: ctx.actorId,
      });
      await audit(tx, ctx, "revise", newId);
    });
    const row = await repo.findProposalById(newId, ctx.tenantId);
    return reply.code(201).send({ data: serialize(row!) });
  });

  // Maker-checker approval (approver ≠ raiser). Emits finance.budget.proposal_approved.
  app.patch("/v1/finance/budget-proposals/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPROVER_ROLES);
    const { id } = idParam.parse(req.params);
    await db.transaction(async (tx) => {
      const row = await repo.findProposalByIdTx(tx, id, ctx.tenantId);
      if (!row) throw new HttpError(404, "NOT_FOUND", "proposal not found");
      try {
        assertProposalTransition(row.status as ProposalStatus, "approved");
        assertProposalApproverDistinct(row.createdBy, ctx.actorId);
      } catch (err) { toDomain(err, 409); }
      await repo.updateProposal(tx, id, {
        status: "approved", approvedBy: ctx.actorId, approvedAt: new Date(), updatedBy: ctx.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.proposalApproved, eventType: EVENTS.proposalApproved,
        tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
        payload: {
          proposalId: id, headId: row.headId, fy: row.fy, deptCode: row.deptCode,
          proposedMinor: row.proposedMinor.toString(),
        },
      });
      await audit(tx, ctx, "approve", id);
    });
    const row = await repo.findProposalById(id, ctx.tenantId);
    return reply.send({ data: serialize(row!) });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });

  // Shared helper: guarded status transition inside a tenant tx.
  async function transition(
    ctx: { tenantId: string; actorId: string; correlationId: string },
    id: string,
    to: ProposalStatus,
    patchFn: (row: BudgetProposalRow) => Record<string, unknown>,
  ): Promise<void> {
    await db.transaction(async (tx) => {
      const row = await repo.findProposalByIdTx(tx, id, ctx.tenantId);
      if (!row) throw new HttpError(404, "NOT_FOUND", "proposal not found");
      try {
        assertProposalTransition(row.status as ProposalStatus, to);
      } catch (err) { toDomain(err, 409); }
      await repo.updateProposal(tx, id, patchFn(row) as Partial<BudgetProposalRow>);
      await audit(tx, ctx, `transition_${to}`, id);
    });
  }
}

async function audit(tx: unknown, ctx: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceId: string): Promise<void> {
  await enqueue(tx as Parameters<typeof enqueue>[0], {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
    payload: { service: "finance", action, resourceType: "budget_proposal", resourceId, outcome: "success" },
  });
}

function serialize(r: BudgetProposalRow) {
  return {
    id: r.id, fy: r.fy, deptCode: r.deptCode, headId: r.headId,
    ceilingMinor: r.ceilingMinor.toString(),
    proposedMinor: r.proposedMinor.toString(),
    breachMinor: ceilingBreachMinor(r.ceilingMinor, r.proposedMinor).toString(),
    currency: r.currency,
    justification: r.justification,
    status: r.status,
    parentId: r.parentId,
    version: r.version,
    reviewNote: r.reviewNote,
    reviewedBy: r.reviewedBy,
    approvedBy: r.approvedBy,
    effectiveFrom: r.effectiveFrom,
  };
}
