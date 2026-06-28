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
} from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

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
