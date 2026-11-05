import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { zMoneyMinor as zMoneyMinorBase } from "@civitasone/schemas/money";
import { zFyLabel, boundedMinorBigint } from "@civitasone/schemas/validators";
import { idempotentId } from "@civitasone/auth";
import { idempotentCreate } from "../../shared/idempotency.js";
import { resolveContext, requireRole, HttpError, financeErrorHandler } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import * as allocRepo from "./allocation-repo.js";
import { findHeadLabels } from "./repo.js";
import { bookedLines, lineFor, type BookedLine } from "./monitoring-books.js";
import type { BudgetAllocationRow } from "./allocation-schema.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];
const READER_ROLES = [...FINANCE_ROLES, "audit_officer"];

// BUG FIX: bigint-safe money fields, matching payments/validators.ts's
// createBillBody.grossMinor pattern — a plain z.number() silently loses
// precision above 2^53 at the JSON.parse boundary, before Zod ever runs.
// FIX: was a hand-rolled union missing a z.number() branch, so any plain
// JSON-number payload (the common case, e.g. allocatedMinor: 1000000000)
// 400'd. zMoneyMinorBase is the canonical @civitasone/schemas/money decoder —
// accepts string | safe-integer number | bigint and rejects unsafe (>2^53)
// numbers, forcing those onto the string path instead of silently losing
// precision.
// UAT T-EDGE TE-04 (BA06): a 1e20 allocation was 202-accepted and dead-lettered (bigint overflow).
const moneyMinorFieldNonNeg = zMoneyMinorBase.pipe(z.bigint().nonnegative().superRefine(boundedMinorBigint));
const moneyMinorField = zMoneyMinorBase.pipe(z.bigint().positive());

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
// UAT T-EDGE TE-07 (BA07): the FY must be a real "YYYY-YY" label with consecutive years (2031-99 was written).
const setAllocBody = z.object({
  headId: z.string().uuid(),
  fy: zFyLabel,
  allocatedMinor: moneyMinorFieldNonNeg,
});

/**
 * UAT T-EDGE TE-04: rules the allocation upsert consumer would otherwise fail on AFTER a 202
 * (dead-lettered, the maker never told), checked here from finance data: the head must exist
 * in this tenant (BA09), and a lowered allocation may not drop below what is already
 * committed + spent on the head for that FY (the chk_allocation_no_overcommit CHECK).
 */
async function assertAllocationAcceptable(tenantId: string, body: { headId: string; fy: string; allocatedMinor: bigint }): Promise<void> {
  const heads = await findHeadLabels(tenantId, [body.headId]);
  if (!heads.has(body.headId)) {
    throw new HttpError(422, "HEAD_NOT_FOUND", "the budget head was not found", [
      { field: "headId", message: "Choose an existing budget head.", code: "HEAD_NOT_FOUND" },
    ]);
  }
  const current = await allocRepo.findAllocation(tenantId, body.headId, body.fy);
  if (current) {
    const used = BigInt(current.committedMinor) + BigInt(current.actualMinor);
    if (body.allocatedMinor < used) {
      throw new HttpError(422, "ALLOCATION_BELOW_COMMITTED", `the allocation cannot be lower than the ${used} paise already committed or spent on this head in ${body.fy}`, [
        { field: "allocatedMinor", message: "This is less than what is already committed or spent on this head.", code: "ALLOCATION_BELOW_COMMITTED" },
      ]);
    }
  }
}

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
    await assertAllocationAcceptable(ctx.tenantId, body);
    // UAT T-EDGE TE-09: one upsert per X-Idempotency-Key (same body replays, other body 422).
    const data = await idempotentCreate(ctx, "finance.budget-allocation.upsert", body, async () => {
      const id = ctx.idempotencyKey ? idempotentId(ctx) : randomUUID();
      await queue.publish(COMMANDS.budgetAllocationUpsert, {
        messageId: id, type: COMMANDS.budgetAllocationUpsert,
        tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
        payload: { id, tenantId: ctx.tenantId, ...body },
      });
      return { id, status: "accepted" };
    });
    return reply.code(202).send({ data });
  });

  app.get("/v1/finance/budget-allocations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = z.object({
      fy: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
    }).parse(req.query);
    const rows = await allocRepo.listAllocations(ctx.tenantId, q.fy, q.limit);
    const [labels, books] = await Promise.all([
      findHeadLabels(ctx.tenantId, rows.map((r) => r.headId)),
      bookedLines(ctx.tenantId, rows),
    ]);
    return reply.send({ data: rows.map((r) => serialize(r, labels, books)) });
  });


  // GET /v1/finance/budget-allocations/:id — get a specific allocation by UUID
  app.get("/v1/finance/budget-allocations/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const rows = await allocRepo.listAllocations(ctx.tenantId, undefined, 500);
    const row = rows.find((r) => r.id === id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "allocation not found");
    const [labels, books] = await Promise.all([findHeadLabels(ctx.tenantId, [row.headId]), bookedLines(ctx.tenantId, [row])]);
    return reply.send({ data: serialize(row, labels, books) });
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

// UAT b15 (R-N1): committed / actual / available are the books-based line Budget Monitoring shows
// (monitoring-books.ts): actual = what the ledger has booked to the head in the FY, committed excludes bills already
// booked. The stored columns stay the ceiling guard maintained by the bill/payment consumers; they are not shown.
function serialize(r: BudgetAllocationRow, labels: Map<string, { code: string; name: string }>, books: ReadonlyMap<string, BookedLine>) {
  const head = labels.get(r.headId);
  const line = lineFor(r, books);
  return {
    id: r.id, headId: r.headId,
    // GAP-FINANCE-BUDGET-ALLOCATION-01: human head label, null when the head
    // id no longer resolves in this tenant (never a guessed name).
    headCode: head?.code ?? null, headName: head?.name ?? null,
    fy: r.fy,
    allocatedMinor: line.allocatedMinor.toString(),
    committedMinor: line.committedMinor.toString(),
    actualMinor: line.actualMinor.toString(),
    availableMinor: (line.allocatedMinor - line.committedMinor - line.actualMinor).toString(),
  };
}
