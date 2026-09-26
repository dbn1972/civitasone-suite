import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { idempotentId } from "@civitasone/auth";
import { queue, cache } from "../../shared/infra.js";
import { db, scopedRead } from "../../shared/db.js";
import { sql } from "drizzle-orm";
import { HttpError } from "../../shared/context.js";
import { COMMANDS } from "../../topics.js";
import { deterministicUuid } from "../../shared/deterministic-id.js";
import { verifyEmployeeExists, HrmsUnavailableError } from "../../shared/hrms-client.js";
import * as repo from "./repo.js";
import { audit } from "./consumer.js";
import type {
  CreateStructureBody, CreateRunBody, CreateDdoBody, CreatePensionerBody,
  CreateArrearBody, ComputeBonusBody, CreateReimbursementBody,
  CreateSalaryRevisionBody, UpdateSettingsBody,
} from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createStructure(ctx: RequestContext, body: CreateStructureBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.structureCreate, {
    messageId: id, type: COMMANDS.structureCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createRun(ctx: RequestContext, body: CreateRunBody): Promise<Accepted> {
  const id = randomUUID();
  const runType = body.runType ?? "regular";
  // structureId is only validated as a well-formed UUID by createRunBody
  // (validators.ts) -- nothing previously checked it actually names a row in
  // payroll.payroll_structures. A well-formed but nonexistent id sailed
  // through to a 202 identical to a real one, and the async consumer
  // (processPayrollRun's repo.listComponentsByStructure) silently returned
  // zero components: a payslip with no BASIC/HRA/etc line items and no error
  // anywhere. Reject synchronously here, before any run is created, so the
  // caller gets a clear 400 instead of a 202 that quietly produces an empty
  // structure. (400, not 404/422, to match this route's other
  // payload-validation failures -- see errorHandler below.) Checked
  // unconditionally, ahead of the runType==="regular" block below, so it
  // also protects that block's own repo.insertRun(structureId: ...) call
  // from ever writing a dangling id.
  if (body.structureId) {
    const struct = await scopedRead((tx) => tx.execute(sql`
      SELECT id FROM payroll.payroll_structures
      WHERE id = ${body.structureId}::uuid AND tenant_id = ${ctx.tenantId}::uuid AND status = 'active'
      LIMIT 1
    `));
    if (!struct[0]) {
      throw new HttpError(400, "STRUCTURE_NOT_FOUND", `payroll structure ${body.structureId} does not exist for this tenant`);
    }
  }
  const ddoCode = body.ddoCode ?? null;
  // Concurrency fix (High, proven via a genuine `Promise.all` repro): BUG-3
  // and round2 (see the history of this comment, and consumer.ts's own
  // "round2 fix" note on COMMANDS.runCreate) made this guard correctly
  // RLS-scoped and correctly WHERE-aligned with the DB's partial unique
  // index, but it was still a bare, unlocked SELECT. Two genuinely
  // concurrent requests for the same tenant+month+DDO both passed it before
  // either had written anything, so BOTH got 202 with two different run
  // ids — the real conflict only ever surfaced later, invisibly, inside the
  // async consumer's own advisory-lock guard, by which point the HTTP
  // response had already gone out to both callers with no way to take it
  // back (the sequential case — a second attempt made AFTER the first's row
  // already exists — always got a clean 409; only true concurrency slipped
  // through).
  //
  // Fix, mirroring PR #1585 (hrms screening-decision override race): move
  // the race-prone check-and-write out of the fire-and-forget queue path
  // and into a synchronous transaction here, so the loser's HTTP response
  // reflects the real, atomically-determined outcome instead of an
  // optimistic guess. This takes the SAME transaction-scoped advisory lock
  // (identical key) consumer.ts's runCreate handler used to take alone, and
  // does the duplicate check AND the row insert (+ audit event) itself,
  // before ever publishing anything — so by the time a concurrent caller's
  // own lock-wait ends, the row it needs to see already exists, and it gets
  // a real, immediate 409 instead of a later, invisible one. The queue
  // publish below still happens for every run (regular or not); for a
  // regular run it now only triggers the (unaffected, still fully async)
  // per-employee processing — consumer.ts's handler recognizes the row
  // already exists and skips re-creating it (see that handler's comment).
  //
  // Scoped to runType === "regular": the partial unique index (and so this
  // whole race) only applies to that type. Off-cycle run creation
  // (supplementary/arrears/pensioner) has no such uniqueness constraint and
  // is untouched — still a plain publish, exactly as before.
  if (runType === "regular") {
    await db.transaction(async (tx) => {
      const lockKey = `payroll_run:${ctx.tenantId}:${body.month}:${ddoCode ?? "__ALL__"}:regular`;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

      const existing = await tx.execute(sql`
        SELECT id FROM payroll.payroll_runs
        WHERE tenant_id = ${ctx.tenantId}::uuid AND month = ${body.month}
          AND status <> 'failed' AND run_type = 'regular'
          AND COALESCE(ddo_code, '__ALL__') = ${ddoCode ?? "__ALL__"}
        LIMIT 1
      `);
      if (existing[0]) {
        throw new HttpError(409, "DUPLICATE_RUN_FOR_PERIOD",
          `a regular payroll run already exists for ${body.month}${ddoCode ? ` (DDO ${ddoCode})` : ""}: ${existing[0].id}`);
      }

      // structureId is guaranteed present here by createRunBody's own
      // .refine (required for every runType except "pensioner", and this
      // branch is only ever "regular") — the `!` reflects that validated
      // invariant, not an unchecked assumption.
      await repo.insertRun(tx, {
        id, tenantId: ctx.tenantId, runNo: body.runNo, month: body.month,
        departmentId: body.departmentId ?? null, structureId: body.structureId!,
        runType, ddoCode,
        totalGrossMinor: 0n, totalNetMinor: 0n, currency: "INR", status: "processing",
        createdBy: ctx.actorId, updatedBy: ctx.actorId,
      });
      await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId }, "create", "payroll_run", id);
    });
  }
  await queue.publish(COMMANDS.runCreate, {
    messageId: id, type: COMMANDS.runCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body, status: "draft" },
  });
  await cache.put(cache.makeKey(ctx.tenantId, "payroll_run", id), { id, ...body, status: "draft" });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function approveRun(ctx: RequestContext, id: string): Promise<Accepted> {
  await queue.publish(COMMANDS.runApprove, {
    messageId: deterministicUuid(`payroll-approve:${id}`),
    type: COMMANDS.runApprove,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, approvedBy: ctx.actorId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "payroll_run", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function disburseRun(ctx: RequestContext, id: string): Promise<Accepted> {
  await queue.publish(COMMANDS.runDisburse, {
    messageId: deterministicUuid(`payroll-disburse:${id}`),
    type: COMMANDS.runDisburse,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "payroll_run", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function revertRun(ctx: RequestContext, id: string): Promise<Accepted> {
  await queue.publish(COMMANDS.runRevert, {
    messageId: deterministicUuid(`payroll-revert:${id}`),
    type: COMMANDS.runRevert,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, revertedBy: ctx.actorId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "payroll_run", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

// ─── CQRS lift (quality-payroll-95) ─────────────────────────────────────────
// routes.ts (ddos/pensioners) and world-class-routes.ts (arrears/bonus/
// reimbursements) used to write synchronously in the request path (raw SQL
// INSERT / Drizzle insert). Moved to publish + idempotent consumer here,
// mirroring works-service #354's masters/billing CQRS lift.

/**
 * DDO upsert. payroll_ddos has no surrogate id (ddo_code is the natural key),
 * so the accepted envelope's `id` IS the ddoCode, not a generated uuid.
 */
export async function upsertDdo(ctx: RequestContext, body: CreateDdoBody): Promise<Accepted> {
  await queue.publish(COMMANDS.ddoUpsert, {
    messageId: randomUUID(), type: COMMANDS.ddoUpsert,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { tenantId: ctx.tenantId, ...body },
  });
  return { id: body.ddoCode, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Pensioner master create. Money fields are bigint (paise) — stringified for
 * the wire, parsed back with BigInt(...) in the consumer. SEC-P1-06 PII
 * encryption (bank account/IFSC/PAN) is applied by the consumer's Drizzle
 * insert (payrollPensioners uses encryptedText columns), same as the prior
 * synchronous handler.
 */
export async function createPensioner(ctx: RequestContext, body: CreatePensionerBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.pensionerCreate, {
    messageId: id, type: COMMANDS.pensionerCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: {
      id, tenantId: ctx.tenantId,
      ppoNo: body.ppoNo, fullName: body.fullName, dateOfBirth: body.dateOfBirth,
      basicPensionMinor: body.basicPensionMinor.toString(),
      commutedPensionMinor: (body.commutedPensionMinor ?? 0n).toString(),
      commutationDate: body.commutationDate ?? null,
      medicalAllowanceMinor: (body.medicalAllowanceMinor ?? 0n).toString(),
      ddoCode: body.ddoCode ?? null,
      bankAccountNo: body.bankAccountNo ?? null,
      bankIfsc: body.bankIfsc ?? null,
      pan: body.pan ?? null,
      taxRegime: body.taxRegime,
    },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * round2 fix: employeeId on arrears/bonus/reimbursements was never checked
 * against a real employee — payroll and HRMS are separate databases (no
 * DB-level FK possible), and no application-level check existed either. A
 * fabricated, nowhere-existing employeeId was accepted and durably
 * persisted. Verify existence in the caller's own tenant BEFORE publishing —
 * the same "reject synchronously, don't 202 into a silent async no-op"
 * principle as the run-creation duplicate guard elsewhere in this file.
 *
 * round2 review fix: remap HrmsUnavailableError to the same 502
 * HRMS_UNAVAILABLE this service's other HRMS-dependent call sites already
 * use (tax/routes.ts's Form 16 build, form16-pdf/routes.ts's PDF issuance)
 * instead of letting it fall through to the generic 500 catch-all — bug 4
 * in this same round was specifically about not doing that.
 */
async function assertEmployeeExists(ctx: RequestContext, employeeId: string): Promise<void> {
  let exists: boolean;
  try {
    exists = await verifyEmployeeExists(ctx.tenantId, employeeId);
  } catch (err) {
    if (err instanceof HrmsUnavailableError) {
      throw new HttpError(502, "HRMS_UNAVAILABLE", "cannot verify employee: HRMS identity source unreachable");
    }
    throw err;
  }
  if (!exists) {
    throw new HttpError(404, "NOT_FOUND", "employee not found");
  }
}

/** Arrear create. */
export async function createArrear(ctx: RequestContext, body: CreateArrearBody): Promise<Accepted> {
  await assertEmployeeExists(ctx, body.employeeId);
  const id = randomUUID();
  await queue.publish(COMMANDS.arrearCreate, {
    messageId: id, type: COMMANDS.arrearCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Bonus compute. The bonusAmountMinor calculation (basicMinor * bonusPct /
 * 100) now runs in the consumer — single source of truth alongside the
 * persisted row, rather than trusting a value computed in the HTTP handler.
 */
export async function computeBonus(ctx: RequestContext, body: ComputeBonusBody): Promise<Accepted> {
  await assertEmployeeExists(ctx, body.employeeId);
  const id = randomUUID();
  await queue.publish(COMMANDS.bonusCompute, {
    messageId: id, type: COMMANDS.bonusCompute,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/** Reimbursement create. */
export async function createReimbursement(ctx: RequestContext, body: CreateReimbursementBody): Promise<Accepted> {
  await assertEmployeeExists(ctx, body.employeeId);
  const id = randomUUID();
  await queue.publish(COMMANDS.reimbursementCreate, {
    messageId: id, type: COMMANDS.reimbursementCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * F3 leftover CQRS: salary revision create. world-class-routes.ts POST
 * /v1/payroll/salary-revisions used to INSERT synchronously in the request
 * path (marked "// ─── Gap:" — added after the rest of this file's F3
 * conversion and missed it). Same shape as createArrear/createReimbursement
 * above: publish + let the consumer persist idempotently.
 *
 * MEDIUM finding: `id` (both the new revision row's own primary key AND the
 * queue messageId -- the same double-duty id<->messageId pattern
 * hrms-service's hireApplication uses) used to be a fresh randomUUID() per
 * call, so a retried/double-clicked create-revision request published a
 * second, unrelated messageId that sailed straight past markProcessed's
 * dedup and would let the consumer insert a second revision row for the
 * same underlying change. Salary revision is one of the Recruitment ->
 * HRMS -> Payroll integration-seam publishes this fix scopes to (hire/
 * transfer/separation/salary-revision), so it's now derived via
 * idempotentId() (@civitasone/auth, tenant-scoped since PR #1565) -- the
 * same mechanism hrms-service's hireApplication/separateEmployee/
 * transferEmployee use, instead of a fresh random id.
 *
 * Keyed on employeeId + effectiveDate + revisionType, NOT employeeId alone:
 * a revision is not one-time-use (annual increments recur yearly, and a
 * correction can follow a promotion on a different date), so those three
 * fields identify THIS specific revision request without colliding with a
 * later, genuinely different one for the same employee.
 */
export async function createSalaryRevision(ctx: RequestContext, body: CreateSalaryRevisionBody): Promise<Accepted> {
  // Prefers a genuine client-supplied key (ctx.idempotencyKey, from the
  // x-idempotency-key header) when sent; falls back to this deterministic
  // domain key otherwise -- see hrms-service's hireApplication for the
  // identical rationale.
  const id = idempotentId({
    idempotencyKey: ctx.idempotencyKey ?? `payroll.salary-revision:${body.employeeId}:${body.effectiveDate}:${body.revisionType}`,
    tenantId: ctx.tenantId,
  });
  await queue.publish(COMMANDS.salaryRevisionCreate, {
    messageId: id, type: COMMANDS.salaryRevisionCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * F3 leftover CQRS: payroll settings upsert. world-class-routes.ts PUT
 * /v1/payroll/settings used to upsert synchronously in the request path
 * (same "// ─── Gap:" follow-up addition as salary revisions above).
 * payroll_settings has no surrogate id (tenant_id is the natural key, one
 * row per tenant), so the accepted envelope's `id` is the tenantId —
 * mirrors upsertDdo/upsertStateRules returning their natural key below.
 */
export async function updateSettings(ctx: RequestContext, body: UpdateSettingsBody): Promise<Accepted> {
  await queue.publish(COMMANDS.settingsUpdate, {
    messageId: randomUUID(), type: COMMANDS.settingsUpdate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { tenantId: ctx.tenantId, ...body },
  });
  return { id: ctx.tenantId, status: "accepted", correlationId: ctx.correlationId };
}

// ─── CQRS lift T1-03 (payroll/gap-routes.ts) ────────────────────────────────
// gap-routes.ts previously did db.execute() INSERT/UPDATE in the request path
// for corrections, pay-groups, flex-benefit plans/elections, costing rules,
// off-cycle runs, off-cycle processing, and state-rules. These are now
// publish + idempotent consumer, mirroring ddo/pensioner/arrear/bonus above.

export type CreateCorrectionInput = {
  employeeId: string; component: string; effectiveFrom: string;
  newValueMinor: number; oldValueMinor: number; reason?: string | undefined;
  affectedPeriods: number; arrearsMinor: string;
};
export async function createCorrection(ctx: RequestContext, body: CreateCorrectionInput): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.correctionCreate, {
    messageId: id, type: COMMANDS.correctionCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export type CreatePayGroupInput = {
  name: string; frequency: "monthly" | "bi_weekly" | "weekly";
  payDayOfMonth: number; timezone: string;
};
export async function createPayGroup(ctx: RequestContext, body: CreatePayGroupInput): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.payGroupCreate, {
    messageId: id, type: COMMANDS.payGroupCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export type CreateFlexPlanInput = {
  name: string; fy: string; totalBudgetMinor: number;
  components: Array<{ name: string; maxMinor: number; taxExempt: boolean }>;
};
export async function createFlexPlan(ctx: RequestContext, body: CreateFlexPlanInput): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.flexPlanCreate, {
    messageId: id, type: COMMANDS.flexPlanCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export type UpsertFlexElectionInput = {
  planId: string; fy: string;
  elections: Array<{ component: string; electedMinor: number }>;
  totalElectedMinor: number;
};
export async function upsertFlexElection(ctx: RequestContext, body: UpsertFlexElectionInput): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.flexElectionUpsert, {
    messageId: id, type: COMMANDS.flexElectionUpsert,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export type UpsertCostingRuleInput = {
  employeeGroup: string; costCenterId: string; splitPct: number;
};
export async function upsertCostingRule(ctx: RequestContext, body: UpsertCostingRuleInput): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.costingRuleUpsert, {
    messageId: id, type: COMMANDS.costingRuleUpsert,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export type CreateOffCycleInput = {
  runType: "bonus" | "incentive" | "adhoc"; period: string;
  description?: string | undefined; totalAmountMinor: string;
  items: Array<{ employeeId: string; amountMinor: number }>;
};
export async function createOffCycle(ctx: RequestContext, body: CreateOffCycleInput): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.offCycleCreate, {
    messageId: id, type: COMMANDS.offCycleCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Off-cycle process command. The 30% flat-tax computation now runs in the
 * consumer (single source of truth), not the HTTP handler.
 */
export async function processOffCycle(ctx: RequestContext, offCycleId: string): Promise<Accepted> {
  await queue.publish(COMMANDS.offCycleProcess, {
    messageId: deterministicUuid(`payroll-offcycle-process:${offCycleId}`),
    type: COMMANDS.offCycleProcess,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id: offCycleId, tenantId: ctx.tenantId },
  });
  return { id: offCycleId, status: "accepted", correlationId: ctx.correlationId };
}

export type UpsertStateRulesInput = {
  stateCode: string;
  ptSlabs?: Array<{ fromMinor: number; toMinor: number; taxMinor: number }> | undefined;
  lwfEmployee?: number | undefined;
  lwfEmployer?: number | undefined;
};
export async function upsertStateRules(ctx: RequestContext, body: UpsertStateRulesInput): Promise<Accepted> {
  await queue.publish(COMMANDS.stateRulesUpsert, {
    messageId: randomUUID(), type: COMMANDS.stateRulesUpsert,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { tenantId: ctx.tenantId, ...body },
  });
  return { id: body.stateCode, status: "accepted", correlationId: ctx.correlationId };
}
