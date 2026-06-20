import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateContractBody, AmendContractBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createContract(ctx: RequestContext, body: CreateContractBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.contractCreate, {
    messageId: id, type: COMMANDS.contractCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function amendContract(ctx: RequestContext, id: string, body: AmendContractBody): Promise<Accepted> {
  await queue.publish(COMMANDS.contractAmend, {
    type: COMMANDS.contractAmend,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "contract", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
