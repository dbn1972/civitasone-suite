import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./distribution-repo.js";
import {
  assertDistributionAmountValid, assertDistinctOffices,
  remainingDistributable,
} from "./distribution-domain.js";
import { DomainError } from "./domain.js";
import { createDistributionBody, acknowledgeBody, distributionQuery, idParam, allocIdParam } from "./distribution-validators.js";
import type { AllocationDistributionRow } from "./distribution-schema.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];
const READER_ROLES = [...FINANCE_ROLES, "audit_officer"];

function toDomain(err: unknown, status = 400): never {
  if (err instanceof DomainError) throw new HttpError(status, err.code, err.message);
  throw err;
}

export async function allocationDistributionRoutes(app: FastifyInstance): Promise<void> {
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
    await queue.publish(COMMANDS.allocationDistributionCreate, {
      messageId: id, type: COMMANDS.allocationDistributionCreate,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: {
        id, tenantId: ctx.tenantId, allocationId: body.allocationId,
        fromOfficeId: body.fromOfficeId, toOfficeId: body.toOfficeId,
        amountMinor: body.amountMinor, currency: body.currency,
        conditions: body.conditions ?? null, effectiveFrom: body.effectiveFrom,
      },
    });
    return reply.code(202).send({ data: { id, status: "accepted" } });
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

  app.patch("/v1/finance/allocation-distributions/:id/issue", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = idParam.parse(req.params);
    await queue.publish(COMMANDS.allocationDistributionIssue, {
      messageId: randomUUID(), type: COMMANDS.allocationDistributionIssue,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId },
    });
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });

  app.patch("/v1/finance/allocation-distributions/:id/acknowledge", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = acknowledgeBody.parse(req.body);
    await queue.publish(COMMANDS.allocationDistributionAcknowledge, {
      messageId: randomUUID(), type: COMMANDS.allocationDistributionAcknowledge,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId, note: body.note },
    });
    return reply.code(202).send({ data: { id, status: "accepted" } });
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
