import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateRequestBody, UpdateRequestBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createRequest(ctx: RequestContext, body: CreateRequestBody & { citizenId: string }): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.serviceRequestSubmit, {
    messageId: id, type: COMMANDS.serviceRequestSubmit,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateRequest(ctx: RequestContext, id: string, body: UpdateRequestBody): Promise<Accepted> {
  await queue.publish(COMMANDS.serviceRequestUpdate, {
    messageId: randomUUID(), type: COMMANDS.serviceRequestUpdate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
