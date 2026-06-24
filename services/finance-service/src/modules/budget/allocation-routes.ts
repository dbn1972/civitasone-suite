import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import * as allocRepo from "./allocation-repo.js";
import { assertReappropriable } from "./allocation-domain.js";
import { DomainError } from "./domain.js";
import type { BudgetAllocationRow } from "./allocation-schema.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];
const READER_ROLES = [...FINANCE_ROLES, "audit_officer"];

const setAllocBody = z.object({
  headId: z.string().uuid(),
  fy: z.string().regex(/^\d{4}-\d{2}$/),
  allocatedMinor: z.number().int().nonnegative(),
  enforce: z.boolean().optional(),
});

const reapprBody = z.object({
  fy: z.string().regex(/^\d{4}-\d{2}$/),
  fromHeadId: z.string().uuid(),
  toHeadId: z.string().uuid(),
  amountMinor: z.number().int().positive(),
  reason: z.string().optional(),
});

export async function budgetAllocationRoutes(app: FastifyInstance): Promise<void> {
  // Set / update an allocation for a head + FY
  app.post("/v1/finance/budget-allocations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const body = setAllocBody.parse(req.body);
    await db.transaction(async (tx) => {
      await allocRepo.upsertAllocation(tx, {
        id: randomUUID(),
        tenantId: ctx.tenantId,
        headId: body.headId,
        fy: body.fy,
        allocatedMinor: BigInt(body.allocatedMinor),
        ...(body.enforce !== undefined ? { enforce: body.enforce } : {}),
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });
    });
    const row = await allocRepo.findAllocation(ctx.tenantId, body.headId, body.fy);
    return reply.code(201).send({ data: serialize(row!) });
  });

  app.get("/v1/finance/budget-allocations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = z.object({
      fy: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
    }).parse(req.query);
    const rows = await allocRepo.listAllocations(ctx.tenantId, q.fy, q.limit);
    return reply.send({ data: rows.map(serialize) });
  });

  // Re-appropriation: move allocation between heads (audited)
  app.post("/v1/finance/budget-allocations/re-appropriate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const body = reapprBody.parse(req.body);
    if (body.fromHeadId === body.toHeadId) {
      throw new HttpError(400, "INVALID_REAPPROPRIATION", "source and target heads must differ");
    }
    try {
      await db.transaction(async (tx) => {
        const from = await allocRepo.findAllocationTx(tx, ctx.tenantId, body.fromHeadId, body.fy);
        if (!from) throw new HttpError(404, "NOT_FOUND", "source allocation not found");
        assertReappropriable(from, BigInt(body.amountMinor));
        let to = await allocRepo.findAllocationTx(tx, ctx.tenantId, body.toHeadId, body.fy);
        if (!to) {
          await allocRepo.upsertAllocation(tx, {
            id: randomUUID(), tenantId: ctx.tenantId, headId: body.toHeadId, fy: body.fy,
            allocatedMinor: 0n, createdBy: ctx.actorId, updatedBy: ctx.actorId,
          });
          to = await allocRepo.findAllocationTx(tx, ctx.tenantId, body.toHeadId, body.fy);
        }
        await allocRepo.moveAllocation(tx, from.id, to!.id, BigInt(body.amountMinor));
        await allocRepo.logReappropriation(tx, {
          id: randomUUID(), tenantId: ctx.tenantId, fy: body.fy,
          fromHeadId: body.fromHeadId, toHeadId: body.toHeadId,
          amountMinor: BigInt(body.amountMinor),
          ...(body.reason ? { reason: body.reason } : {}),
          createdBy: ctx.actorId,
        });
      });
    } catch (err) {
      if (err instanceof DomainError) throw new HttpError(409, err.code, err.message);
      throw err;
    }
    const from = await allocRepo.findAllocation(ctx.tenantId, body.fromHeadId, body.fy);
    const to = await allocRepo.findAllocation(ctx.tenantId, body.toHeadId, body.fy);
    return reply.send({ data: { from: serialize(from!), to: serialize(to!) } });
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

function serialize(r: BudgetAllocationRow) {
  return {
    id: r.id, headId: r.headId, fy: r.fy,
    allocatedMinor: r.allocatedMinor.toString(),
    committedMinor: r.committedMinor.toString(),
    actualMinor: r.actualMinor.toString(),
    availableMinor: (r.allocatedMinor - r.committedMinor - r.actualMinor).toString(),
    enforce: r.enforce,
  };
}
