import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import * as allocRepo from "./allocation-repo.js";
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
  app.post("/v1/finance/budget-allocations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const body = setAllocBody.parse(req.body);
    const id = randomUUID();
    await queue.publish(COMMANDS.budgetAllocationUpsert, {
      messageId: id, type: COMMANDS.budgetAllocationUpsert,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId, ...body },
    });
    return reply.code(202).send({ data: { id, status: "accepted" } });
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

  app.post("/v1/finance/budget-allocations/re-appropriate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const body = reapprBody.parse(req.body);
    if (body.fromHeadId === body.toHeadId) {
      throw new HttpError(400, "INVALID_REAPPROPRIATION", "source and target heads must differ");
    }
    if (body.amountMinor <= 0) {
      throw new HttpError(400, "INVALID_AMOUNT", "re-appropriation amount must be positive");
    }
    const id = randomUUID();
    await queue.publish(COMMANDS.budgetAllocationReappropriate, {
      messageId: id, type: COMMANDS.budgetAllocationReappropriate,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: {
        id, tenantId: ctx.tenantId, ...body,
        toAllocId: randomUUID(), logId: randomUUID(),
      },
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
