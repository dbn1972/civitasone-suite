import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./distribution-repo.js";
import {
  assertDistributionAmountValid, assertDistinctOffices, assertWithinAllocation,
  assertDistributionTransition, assertAcknowledgerDistinct, remainingDistributable,
  type DistributionStatus,
} from "./distribution-domain.js";
import { DomainError } from "./domain.js";
import { createDistributionBody, acknowledgeBody, distributionQuery, idParam, allocIdParam } from "./distribution-validators.js";
import type { AllocationDistributionRow } from "./distribution-schema.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];
const READER_ROLES = [...FINANCE_ROLES, "audit_officer"];
const AUDIT_TOPIC = "audit.event.record";

function toDomain(err: unknown, status = 400): never {
  if (err instanceof DomainError) throw new HttpError(status, err.code, err.message);
  throw err;
}

export async function allocationDistributionRoutes(app: FastifyInstance): Promise<void> {
  // Distribute a slice of a parent allocation to a subordinate office (draft).
  // The over-distribution guard reads the running distributed total inside the
  // tx so concurrent distributions cannot jointly overdraw the allocation.
  app.post("/v1/finance/allocation-distributions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const body = createDistributionBody.parse(req.body);
    const amount = BigInt(body.amountMinor);
    try {
      assertDistributionAmountValid(amount);
      assertDistinctOffices(body.fromOfficeId, body.toOfficeId);
    } catch (err) { toDomain(err); }
    const id = randomUUID();
    await db.transaction(async (tx) => {
      const alloc = await repo.findAllocationByIdTx(tx, body.allocationId, ctx.tenantId);
      if (!alloc) throw new HttpError(404, "NOT_FOUND", "parent allocation not found");
      const distributed = await repo.sumDistributedTx(tx, body.allocationId, ctx.tenantId);
      try {
        assertWithinAllocation(alloc.allocatedMinor, distributed, amount);
      } catch (err) { toDomain(err, 409); }
      await repo.insertDistribution(tx, {
        id, tenantId: ctx.tenantId, allocationId: body.allocationId, fy: alloc.fy, headId: alloc.headId,
        fromOfficeId: body.fromOfficeId, toOfficeId: body.toOfficeId, amountMinor: amount,
        currency: body.currency, conditions: body.conditions ?? null, status: "draft",
        effectiveFrom: body.effectiveFrom ?? new Date().toISOString().slice(0, 10),
        createdBy: ctx.actorId, updatedBy: ctx.actorId,
      });
      await audit(tx, ctx, "create", id);
    });
    const row = await repo.findDistributionById(id, ctx.tenantId);
    return reply.code(201).send({ data: serialize(row!) });
  });

  app.get("/v1/finance/allocation-distributions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = distributionQuery.parse(req.query);
    const rows = await repo.listDistributions(ctx.tenantId, { allocationId: q.allocationId, fy: q.fy, toOfficeId: q.toOfficeId }, q.limit);
    return reply.send({ data: rows.map(serialize) });
  });

  app.get("/v1/finance/allocation-distributions/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await repo.findDistributionById(id, ctx.tenantId);
    if (!row) throw new HttpError(404, "NOT_FOUND", "distribution not found");
    return reply.send({ data: serialize(row) });
  });

  // Distribution summary for a parent allocation: distributed vs remaining.
  app.get("/v1/finance/budget-allocations/:allocationId/distribution-summary", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { allocationId } = allocIdParam.parse(req.params);
    const result = await db.transaction(async (tx) => {
      const alloc = await repo.findAllocationByIdTx(tx, allocationId, ctx.tenantId);
      if (!alloc) throw new HttpError(404, "NOT_FOUND", "allocation not found");
      const distributed = await repo.sumDistributedTx(tx, allocationId, ctx.tenantId);
      return { allocated: alloc.allocatedMinor, distributed };
    });
    return reply.send({
      allocationId,
      allocatedMinor: result.allocated.toString(),
      distributedMinor: result.distributed.toString(),
      remainingMinor: remainingDistributable(result.allocated, result.distributed).toString(),
    });
  });

  // Issue a draft distribution → it becomes effective and is signalled to the
  // receiving office via finance.budget.allocation_distributed.
  app.patch("/v1/finance/allocation-distributions/:id/issue", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = idParam.parse(req.params);
    await db.transaction(async (tx) => {
      const row = await repo.findDistributionByIdTx(tx, id, ctx.tenantId);
      if (!row) throw new HttpError(404, "NOT_FOUND", "distribution not found");
      try {
        assertDistributionTransition(row.status as DistributionStatus, "issued");
      } catch (err) { toDomain(err, 409); }
      await repo.updateDistribution(tx, id, { status: "issued", issuedBy: ctx.actorId, issuedAt: new Date(), updatedBy: ctx.actorId });
      await enqueue(tx, {
        topic: EVENTS.allocationDistributed, eventType: EVENTS.allocationDistributed,
        tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
        payload: {
          distributionId: id, allocationId: row.allocationId, headId: row.headId, fy: row.fy,
          toOfficeId: row.toOfficeId, amountMinor: row.amountMinor.toString(),
          effectiveFrom: row.effectiveFrom,
        },
      });
      await audit(tx, ctx, "issue", id);
    });
    const row = await repo.findDistributionById(id, ctx.tenantId);
    return reply.send({ data: serialize(row!) });
  });

  // Receiving office acknowledges an issued distribution. Acknowledger ≠ issuer.
  app.patch("/v1/finance/allocation-distributions/:id/acknowledge", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = acknowledgeBody.parse(req.body);
    await db.transaction(async (tx) => {
      const row = await repo.findDistributionByIdTx(tx, id, ctx.tenantId);
      if (!row) throw new HttpError(404, "NOT_FOUND", "distribution not found");
      try {
        assertDistributionTransition(row.status as DistributionStatus, "acknowledged");
        assertAcknowledgerDistinct(row.issuedBy ?? row.createdBy, ctx.actorId);
      } catch (err) { toDomain(err, 409); }
      await repo.updateDistribution(tx, id, {
        status: "acknowledged", acknowledgedBy: ctx.actorId, acknowledgedAt: new Date(),
        acknowledgeNote: body.note, updatedBy: ctx.actorId,
      });
      await audit(tx, ctx, "acknowledge", id);
    });
    const row = await repo.findDistributionById(id, ctx.tenantId);
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
    payload: { service: "finance", action, resourceType: "allocation_distribution", resourceId, outcome: "success" },
  });
}

function serialize(r: AllocationDistributionRow) {
  return {
    id: r.id, allocationId: r.allocationId, fy: r.fy, headId: r.headId,
    fromOfficeId: r.fromOfficeId, toOfficeId: r.toOfficeId,
    amountMinor: r.amountMinor.toString(), currency: r.currency,
    conditions: r.conditions, status: r.status,
    effectiveFrom: r.effectiveFrom,
    issuedBy: r.issuedBy, acknowledgedBy: r.acknowledgedBy, acknowledgeNote: r.acknowledgeNote,
    version: r.version,
  };
}
