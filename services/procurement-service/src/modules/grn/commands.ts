import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateGrnBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createGrn(ctx: RequestContext, body: CreateGrnBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.grnCreate, {
    messageId: id, type: COMMANDS.grnCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function acceptGrn(ctx: RequestContext, id: string): Promise<Accepted> {
  const msgId = randomUUID();
  await queue.publish(COMMANDS.grnAccept, {
    messageId: msgId, type: COMMANDS.grnAccept,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function rejectGrn(ctx: RequestContext, id: string, reason: string): Promise<Accepted> {
  const msgId = randomUUID();
  await queue.publish(COMMANDS.grnReject, {
    messageId: msgId, type: COMMANDS.grnReject,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, reason },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
