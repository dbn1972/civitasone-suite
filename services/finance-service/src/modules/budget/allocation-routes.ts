import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError, financeErrorHandler } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import * as allocRepo from "./allocation-repo.js";
import type { BudgetAllocationRow } from "./allocation-schema.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];
const READER_ROLES = [...FINANCE_ROLES, "audit_officer"];

// BUG FIX: bigint-safe money fields, matching payments/validators.ts's
// createBillBody.grossMinor pattern — a plain z.number() silently loses
// precision above 2^53 at the JSON.parse boundary, before Zod ever runs.
const moneyMinorFieldNonNeg = z.union([
  z.string().regex(/^\d+$/, "must be a non-negative integer string").transform((s) => BigInt(s)),
  z.bigint().nonnegative(),
]).pipe(z.bigint().nonnegative());

const moneyMinorField = z.union([
  z.string().regex(/^\d+$/, "must be a positive integer string").transform((s) => BigInt(s)),
  z.bigint().positive(),
]).pipe(z.bigint().positive());

// BUG FIX (misleading dead flag): `enforce` used to be accepted here (and
// threaded through to the guarded UPDATE in allocation-repo.ts), but the
// unconditional DB CHECK chk_allocation_no_overcommit
// (migrations/0056_allocation_no_overcommit.sql) makes it impossible for
// committed+actual to ever exceed allocated regardless of this flag — so
// enforce=false never actually bypassed the ceiling, it just swapped a clean
// OVER_APPROPRIATION domain error for a raw untriaged PostgresError once the
// DB constraint (not the app guard) rejected the write. Removed entirely
// rather than "fixed" to still look configurable: nothing in this codebase
// can make a Postgres CHECK constraint conditional/deferrable (see that
// migration's own note — CHECK constraints can't be DEFERRABLE at all), and a
// govt appropriation ceiling that can be silently soft-disabled doesn't fit
// this platform's compliance model (GFR Rule 10 re-appropriation is the
// correct, audited way to move headroom between heads). DB column dropped in
// migrations/0067_drop_allocation_enforce.sql.
const setAllocBody = z.object({
  headId: z.string().uuid(),
  fy: z.string().regex(/^\d{4}-\d{2}$/),
  allocatedMinor: moneyMinorFieldNonNeg,
});

const reapprBody = z.object({
  fy: z.string().regex(/^\d{4}-\d{2}$/),
  fromHeadId: z.string().uuid(),
  toHeadId: z.string().uuid(),
  amountMinor: moneyMinorField,
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


  // GET /v1/finance/budget-allocations/:id — get a specific allocation by UUID
  app.get("/v1/finance/budget-allocations/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const rows = await allocRepo.listAllocations(ctx.tenantId, undefined, 500);
    const row = rows.find((r) => r.id === id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "allocation not found");
    return reply.send({ data: serialize(row) });
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

  app.setErrorHandler(financeErrorHandler);
}

function serialize(r: BudgetAllocationRow) {
  return {
    id: r.id, headId: r.headId, fy: r.fy,
    allocatedMinor: r.allocatedMinor.toString(),
    committedMinor: r.committedMinor.toString(),
    actualMinor: r.actualMinor.toString(),
    availableMinor: (r.allocatedMinor - r.committedMinor - r.actualMinor).toString(),
  };
}
