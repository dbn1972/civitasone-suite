import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateDfaBody, UpdateDfaBody } from "./validators.js";

export type Accepted = { id: string; dfaNo?: string; status: string; correlationId: string };

function envelope(ctx: RequestContext, type: string, payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(),
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload,
  };
}

export async function createDfa(ctx: RequestContext, body: CreateDfaBody): Promise<Accepted> {
  const id = randomUUID();
  // The gapless DFA number is allocated in the consumer transaction (CQRS,
  // same as file/dispatch numbers); the caller discovers it via GET after 202.
  await queue.publish(COMMANDS.dfaCreate, envelope(ctx, COMMANDS.dfaCreate, { id, tenantId: ctx.tenantId, ...body }));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateDfa(ctx: RequestContext, id: string, body: UpdateDfaBody): Promise<Accepted> {
  await queue.publish(COMMANDS.dfaUpdate, envelope(ctx, COMMANDS.dfaUpdate, { id, tenantId: ctx.tenantId, patch: body }));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function submitDfa(ctx: RequestContext, id: string): Promise<Accepted> {
  await queue.publish(COMMANDS.dfaSubmit, envelope(ctx, COMMANDS.dfaSubmit, { id, tenantId: ctx.tenantId }));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function approveDfa(ctx: RequestContext, id: string): Promise<Accepted> {
  await queue.publish(COMMANDS.dfaApprove, envelope(ctx, COMMANDS.dfaApprove, { id, tenantId: ctx.tenantId, approvedBy: ctx.actorId }));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function returnDfa(ctx: RequestContext, id: string, reason: string): Promise<Accepted> {
  await queue.publish(COMMANDS.dfaReturn, envelope(ctx, COMMANDS.dfaReturn, { id, tenantId: ctx.tenantId, reason }));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Record the signing of an approved DFA. Cryptographic e-Sign/DSC is Phase 2;
 * for now this records who signed and when (signatureRef stays null until the
 * Signer adapter lands).
 */
export async function signDfa(ctx: RequestContext, id: string): Promise<Accepted> {
  await queue.publish(COMMANDS.dfaSign, envelope(ctx, COMMANDS.dfaSign, { id, tenantId: ctx.tenantId, signedBy: ctx.actorId }));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function dispatchDfa(
  ctx: RequestContext,
  id: string,
  opts: { mode: string; toAddress?: string | undefined },
): Promise<Accepted> {
  await queue.publish(COMMANDS.dfaDispatch, envelope(ctx, COMMANDS.dfaDispatch, {
    id, tenantId: ctx.tenantId, mode: opts.mode, toAddress: opts.toAddress ?? null,
  }));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
