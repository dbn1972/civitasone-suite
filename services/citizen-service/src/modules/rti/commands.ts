import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { FileRtiBody, RespondRtiBody, AppealRtiBody, TransferRtiBody, DecideRtiAppealBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function fileRti(ctx: RequestContext, body: FileRtiBody & { citizenId: string }): Promise<Accepted> {
  const id = randomUUID();
  // rtiNo is allocated by the consumer from a Postgres sequence inside the insert transaction
  // (shared/numbers.ts) -- never generated here, so a retry cannot replay a colliding value.
  await queue.publish(COMMANDS.rtiFile, {
    messageId: id, type: COMMANDS.rtiFile,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function respondRti(ctx: RequestContext, id: string, body: RespondRtiBody): Promise<Accepted> {
  const responseId = randomUUID();
  await queue.publish(COMMANDS.rtiResponseReceive, {
    messageId: responseId, type: COMMANDS.rtiResponseReceive,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id: responseId, rtiId: id, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "rti", id));
  return { id: responseId, status: "accepted", correlationId: ctx.correlationId };
}

export async function appealRti(ctx: RequestContext, id: string, body: AppealRtiBody & { ownerCitizenId?: string | null }): Promise<Accepted> {
  const appealId = randomUUID();
  await queue.publish(COMMANDS.rtiAppeal, {
    messageId: appealId, type: COMMANDS.rtiAppeal,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    // P0-1: bind to the owner verified at the route; the consumer re-asserts.
    payload: { id: appealId, rtiId: id, tenantId: ctx.tenantId, appealType: body.appealType, grounds: body.grounds, ownerCitizenId: body.ownerCitizenId ?? null },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "rti", id));
  return { id: appealId, status: "accepted", correlationId: ctx.correlationId };
}

/** D2: the appellate authority (rti_appellate) records the first-appeal decision. */
export async function decideRtiAppeal(ctx: RequestContext, rtiId: string, appealId: string, body: DecideRtiAppealBody): Promise<Accepted> {
  await queue.publish(COMMANDS.rtiAppealDecide, {
    messageId: randomUUID(), type: COMMANDS.rtiAppealDecide,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id: appealId, rtiId, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "rti", rtiId));
  return { id: appealId, status: "accepted", correlationId: ctx.correlationId };
}

export async function transferRti(ctx: RequestContext, id: string, body: TransferRtiBody): Promise<Accepted> {
  const transferId = randomUUID();
  await queue.publish(COMMANDS.rtiTransfer, {
    messageId: transferId, type: COMMANDS.rtiTransfer,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id: transferId, rtiId: id, tenantId: ctx.tenantId, toAuthority: body.toAuthority },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "rti", id));
  return { id: transferId, status: "accepted", correlationId: ctx.correlationId };
}
