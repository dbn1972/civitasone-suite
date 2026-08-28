import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import { assertDistinctMakerChecker, DomainError } from "./domain.js";
import type {
  CreateContractBody, AmendContractBody, ApproveContractBody,
  ActivateContractBody, CloseContractBody, TerminateContractBody,
  CompleteMilestoneBody, MarkMilestoneLateBody, RegisterBondBody, TransitionBondBody,
} from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

// NOTE: this fires synchronously right after queue.publish(), i.e. BEFORE the
// async consumer has actually written the mutation to Postgres. Busting the
// list-cache prefix here would be pure overhead (an O(N) SCAN) with no
// correctness benefit -- a reader who hits the list in that window still only
// sees pre-mutation rows, since the write hasn't landed yet either way. The
// list staleness this contract mutation might otherwise cause is fixed where
// it actually matters: consumer.ts calls cache.invalidateResource() AFTER the
// DB transaction commits. This stays a narrow, cheap single-key eviction so a
// reader who already cached the old single-record view sees it drop a little
// sooner, at O(1) cost.
function inval(ctx: RequestContext, id: string): Promise<void> {
  return cache.invalidate(cache.makeKey(ctx.tenantId, "contract", id));
}

/** Load + tenant-scope a contract or 404. */
async function loadScoped(ctx: RequestContext, id: string) {
  const contract = await repo.findContractById(id);
  if (!contract || contract.tenantId !== ctx.tenantId) {
    throw new HttpError(404, "NOT_FOUND", "contract not found");
  }
  return contract;
}

export async function createContract(ctx: RequestContext, body: CreateContractBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.contractCreate, {
    messageId: id, type: COMMANDS.contractCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/** Approve a draft contract (checker). SoD: checker must differ from maker → synchronous 403. */
export async function approveContract(ctx: RequestContext, id: string, body: ApproveContractBody): Promise<Accepted> {
  const contract = await loadScoped(ctx, id);
  try {
    assertDistinctMakerChecker(contract.createdBy, ctx.actorId);
  } catch (err) {
    if (err instanceof DomainError) throw new HttpError(403, err.code, err.message);
    throw err;
  }
  await queue.publish(COMMANDS.contractApprove, {
    messageId: randomUUID(), type: COMMANDS.contractApprove,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await inval(ctx, id);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/** Activate an approved contract (bring it in force). */
export async function activateContract(ctx: RequestContext, id: string, body: ActivateContractBody): Promise<Accepted> {
  await loadScoped(ctx, id);
  await queue.publish(COMMANDS.contractActivate, {
    messageId: randomUUID(), type: COMMANDS.contractActivate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await inval(ctx, id);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/** Close an active contract normally (obligations discharged). */
export async function closeContract(ctx: RequestContext, id: string, body: CloseContractBody): Promise<Accepted> {
  await loadScoped(ctx, id);
  await queue.publish(COMMANDS.contractClose, {
    messageId: randomUUID(), type: COMMANDS.contractClose,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await inval(ctx, id);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/** Terminate a contract early (checker). SoD: terminator must differ from maker → synchronous 403. */
export async function terminateContract(ctx: RequestContext, id: string, body: TerminateContractBody): Promise<Accepted> {
  const contract = await loadScoped(ctx, id);
  try {
    assertDistinctMakerChecker(contract.createdBy, ctx.actorId);
  } catch (err) {
    if (err instanceof DomainError) throw new HttpError(403, err.code, err.message);
    throw err;
  }
  await queue.publish(COMMANDS.contractTerminate, {
    messageId: randomUUID(), type: COMMANDS.contractTerminate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await inval(ctx, id);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function amendContract(ctx: RequestContext, id: string, body: AmendContractBody): Promise<Accepted> {
  await loadScoped(ctx, id);
  await queue.publish(COMMANDS.contractAmend, {
    messageId: randomUUID(), type: COMMANDS.contractAmend,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await inval(ctx, id);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Mark a draft contract as submitted to eOffice for administrative award approval.
 * The eFile itself is raised via the eOffice integration; once it is approved the
 * `contract.award.file_decided` callback (see eoffice-consumer) moves the contract
 * to `approved` (award signed). This transition makes the source state honest while
 * the file is under approval.
 */
export async function submitContractForApproval(ctx: RequestContext, id: string): Promise<Accepted> {
  await loadScoped(ctx, id);
  await queue.publish(COMMANDS.contractSubmitApproval, {
    messageId: randomUUID(), type: COMMANDS.contractSubmitApproval,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId },
  });
  await inval(ctx, id);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/** Complete a milestone on time — queue-first CQRS write. */
export async function completeMilestone(
  ctx: RequestContext, contractId: string, milestoneId: string, body: CompleteMilestoneBody,
): Promise<Accepted> {
  await loadScoped(ctx, contractId);
  const milestone = await repo.findMilestoneById(milestoneId, contractId, ctx.tenantId);
  if (!milestone) throw new HttpError(404, "NOT_FOUND", "milestone not found");
  if (milestone.status === "completed" || milestone.status === "completed_late") {
    throw new HttpError(409, "ALREADY_COMPLETED", "milestone is already completed");
  }
  await queue.publish(COMMANDS.milestoneComplete, {
    messageId: randomUUID(), type: COMMANDS.milestoneComplete,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { contractId, milestoneId, tenantId: ctx.tenantId, achievedDate: body.achievedDate },
  });
  await inval(ctx, contractId);
  return { id: milestoneId, status: "accepted", correlationId: ctx.correlationId };
}

/** Mark milestone late with SLA penalty — queue-first CQRS write. */
export async function markMilestoneLate(
  ctx: RequestContext, contractId: string, milestoneId: string, body: MarkMilestoneLateBody,
): Promise<Accepted> {
  await loadScoped(ctx, contractId);
  const milestone = await repo.findMilestoneById(milestoneId, contractId, ctx.tenantId);
  if (!milestone) throw new HttpError(404, "NOT_FOUND", "milestone not found");
  if (milestone.status === "completed" || milestone.status === "completed_late") {
    throw new HttpError(409, "ALREADY_COMPLETED", "milestone is already completed");
  }
  await queue.publish(COMMANDS.milestoneMarkLate, {
    messageId: randomUUID(), type: COMMANDS.milestoneMarkLate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: {
      contractId, milestoneId, tenantId: ctx.tenantId,
      achievedDate: body.achievedDate, notes: body.notes ?? null,
    },
  });
  await inval(ctx, contractId);
  return { id: milestoneId, status: "accepted", correlationId: ctx.correlationId };
}

/** Register a performance bond / bank guarantee against an active or approved contract. */
export async function registerPerformanceBond(
  ctx: RequestContext, contractId: string, body: RegisterBondBody,
): Promise<Accepted> {
  const contract = await loadScoped(ctx, contractId);
  if (contract.status !== "active" && contract.status !== "approved") {
    throw new HttpError(409, "INVALID_STATUS", "bonds can only be registered on approved or active contracts");
  }
  if (body.validTo < body.validFrom) {
    throw new HttpError(400, "VALIDATION_FAILED", "validTo must be on or after validFrom");
  }
  const id = randomUUID();
  await queue.publish(COMMANDS.bondRegister, {
    messageId: id, type: COMMANDS.bondRegister,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, contractId, tenantId: ctx.tenantId, ...body },
  });
  await inval(ctx, contractId);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/** Transition a held bond to released / claimed / forfeited. */
export async function transitionPerformanceBond(
  ctx: RequestContext, contractId: string, bondId: string, body: TransitionBondBody,
): Promise<Accepted> {
  await loadScoped(ctx, contractId);
  const bond = await repo.findBondById(bondId, contractId, ctx.tenantId);
  if (!bond) throw new HttpError(404, "NOT_FOUND", "performance bond not found");
  if (bond.status !== "held") {
    throw new HttpError(409, "INVALID_STATUS", `bond is already ${bond.status}`);
  }
  await queue.publish(COMMANDS.bondTransition, {
    messageId: randomUUID(), type: COMMANDS.bondTransition,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { contractId, bondId, tenantId: ctx.tenantId, toStatus: body.toStatus, notes: body.notes ?? null },
  });
  await inval(ctx, contractId);
  return { id: bondId, status: "accepted", correlationId: ctx.correlationId };
}
