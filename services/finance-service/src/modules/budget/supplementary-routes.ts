import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./supplementary-repo.js";
import * as budgetRepo from "./repo.js";
import {
  assertSupplementaryValid, assertValidSupplementaryKind, assertSupplementaryApproverDistinct,
  assertSupplementaryTransition, availabilityAfterSupplementary,
  type SupplementaryStatus,
} from "./supplementary-domain.js";
import { DomainError } from "./domain.js";
import { createSupplementaryBody, rejectSupplementaryBody, supplementaryQuery, idParam } from "./supplementary-validators.js";
import type { SupplementaryDemandRow } from "./supplementary-schema.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];
const READER_ROLES = [...FINANCE_ROLES, "audit_officer"];
const APPROVER_ROLES = ["finance_admin", "super_admin"];
const AUDIT_TOPIC = "audit.event.record";

function toDomain(err: unknown, status = 400): never {
  if (err instanceof DomainError) throw new HttpError(status, err.code, err.message);
  throw err;
}

export async function supplementaryRoutes(app: FastifyInstance): Promise<void> {
  // Raise a supplementary demand (pending_approval) against a target budget.
  app.post("/v1/finance/supplementary-demands", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const body = createSupplementaryBody.parse(req.body);
    try {
      assertValidSupplementaryKind(body.kind);
      assertSupplementaryValid({
        amountMinor: BigInt(body.amountMinor), authority: body.authority, limitMinor: BigInt(body.limitMinor),
      });
    } catch (err) { toDomain(err); }
    const id = randomUUID();
    await db.transaction(async (tx) => {
      await repo.insertSupplementary(tx, {
        id, tenantId: ctx.tenantId, fy: body.fy, budgetId: body.budgetId, headId: body.headId,
        amountMinor: BigInt(body.amountMinor), limitMinor: BigInt(body.limitMinor),
        currency: body.currency, kind: body.kind, authority: body.authority, reason: body.reason,
        status: "pending_approval",
        effectiveFrom: body.effectiveFrom ?? new Date().toISOString().slice(0, 10),
        createdBy: ctx.actorId, updatedBy: ctx.actorId,
      });
      await audit(tx, ctx, "create", id);
    });
    const row = await repo.findSupplementaryById(id, ctx.tenantId);
    return reply.code(201).send({ data: serialize(row!) });
  });

  app.get("/v1/finance/supplementary-demands", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = supplementaryQuery.parse(req.query);
    const rows = await repo.listSupplementary(ctx.tenantId, { fy: q.fy, status: q.status, budgetId: q.budgetId }, q.limit);
    return reply.send({ data: rows.map(serialize) });
  });

  app.get("/v1/finance/supplementary-demands/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await repo.findSupplementaryById(id, ctx.tenantId);
    if (!row) throw new HttpError(404, "NOT_FOUND", "supplementary demand not found");
    return reply.send({ data: serialize(row) });
  });

  // Maker-checker approval (approver ≠ raiser). On approval the target budget's
  // BE + RE rise by the granted amount — the updated availability — atomically
  // with the status flip. Emits finance.budget.supplementary_approved.
  app.patch("/v1/finance/supplementary-demands/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPROVER_ROLES);
    const { id } = idParam.parse(req.params);
    let newAvailable = "0";
    await db.transaction(async (tx) => {
      const row = await repo.findSupplementaryByIdTx(tx, id, ctx.tenantId);
      if (!row) throw new HttpError(404, "NOT_FOUND", "supplementary demand not found");
      try {
        assertSupplementaryTransition(row.status as SupplementaryStatus, "approved");
        assertSupplementaryApproverDistinct(row.createdBy, ctx.actorId);
      } catch (err) { toDomain(err, 409); }
      const budget = await budgetRepo.findBudgetByIdTx(tx, row.budgetId);
      if (!budget || budget.tenantId !== ctx.tenantId) {
        throw new HttpError(404, "NOT_FOUND", "target budget not found");
      }
      const applied = await repo.applySupplementaryToBudget(tx, row.budgetId, ctx.tenantId, row.amountMinor, ctx.actorId);
      if (!applied) throw new HttpError(409, "APPLY_FAILED", "could not apply supplementary to budget");
      newAvailable = availabilityAfterSupplementary(budget.reMinor, budget.utilisedMinor, row.amountMinor).toString();
      await repo.updateSupplementary(tx, id, { status: "approved", approvedBy: ctx.actorId, approvedAt: new Date(), updatedBy: ctx.actorId });
      await enqueue(tx, {
        topic: EVENTS.supplementaryApproved, eventType: EVENTS.supplementaryApproved,
        tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
        payload: {
          supplementaryId: id, budgetId: row.budgetId, headId: row.headId, fy: row.fy,
          amountMinor: row.amountMinor.toString(), kind: row.kind, authority: row.authority,
        },
      });
      await audit(tx, ctx, "approve", id);
    });
    const row = await repo.findSupplementaryById(id, ctx.tenantId);
    return reply.send({ data: serialize(row!), newAvailableMinor: newAvailable });
  });

  app.patch("/v1/finance/supplementary-demands/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPROVER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = rejectSupplementaryBody.parse(req.body);
    await db.transaction(async (tx) => {
      const row = await repo.findSupplementaryByIdTx(tx, id, ctx.tenantId);
      if (!row) throw new HttpError(404, "NOT_FOUND", "supplementary demand not found");
      try {
        assertSupplementaryTransition(row.status as SupplementaryStatus, "rejected");
      } catch (err) { toDomain(err, 409); }
      await repo.updateSupplementary(tx, id, { status: "rejected", rejectReason: body.reason, updatedBy: ctx.actorId });
      await audit(tx, ctx, "reject", id);
    });
    const row = await repo.findSupplementaryById(id, ctx.tenantId);
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
}

async function audit(tx: unknown, ctx: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceId: string): Promise<void> {
  await enqueue(tx as Parameters<typeof enqueue>[0], {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
    payload: { service: "finance", action, resourceType: "supplementary_demand", resourceId, outcome: "success" },
  });
}

function serialize(r: SupplementaryDemandRow) {
  return {
    id: r.id, fy: r.fy, budgetId: r.budgetId, headId: r.headId,
    amountMinor: r.amountMinor.toString(), limitMinor: r.limitMinor.toString(),
    currency: r.currency, kind: r.kind, authority: r.authority, reason: r.reason,
    status: r.status, approvedBy: r.approvedBy, rejectReason: r.rejectReason,
    effectiveFrom: r.effectiveFrom, version: r.version,
  };
}
