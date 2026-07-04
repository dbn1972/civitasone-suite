import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { FileRtiBody, RespondRtiBody, AppealRtiBody, TransferRtiBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function fileRti(ctx: RequestContext, body: FileRtiBody & { citizenId: string }): Promise<Accepted> {
  const id = randomUUID();
  const rtiNo = `RTI/${new Date().getFullYear()}/${Date.now()}`;
  await queue.publish(COMMANDS.rtiFile, {
    messageId: id, type: COMMANDS.rtiFile,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, rtiNo, ...body },
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
