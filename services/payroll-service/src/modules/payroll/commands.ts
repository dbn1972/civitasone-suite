import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { deterministicUuid } from "../../shared/deterministic-id.js";
import type {
  CreateStructureBody, CreateRunBody, CreateDdoBody, CreatePensionerBody,
  CreateArrearBody, ComputeBonusBody, CreateReimbursementBody,
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

/** Arrear create. */
export async function createArrear(ctx: RequestContext, body: CreateArrearBody): Promise<Accepted> {
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
  const id = randomUUID();
  await queue.publish(COMMANDS.reimbursementCreate, {
    messageId: id, type: COMMANDS.reimbursementCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
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
