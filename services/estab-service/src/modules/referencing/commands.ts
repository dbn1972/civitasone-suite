import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { AddReferenceBody, RemoveReferenceBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function addReference(ctx: RequestContext, body: AddReferenceBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.referenceAdd, {
    messageId: id, type: COMMANDS.referenceAdd,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function removeReference(ctx: RequestContext, body: RemoveReferenceBody): Promise<Accepted> {
  await queue.publish(COMMANDS.referenceRemove, {
    messageId: randomUUID(), type: COMMANDS.referenceRemove,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { referenceId: body.referenceId, tenantId: ctx.tenantId },
  });
  return { id: body.referenceId, status: "accepted", correlationId: ctx.correlationId };
}
