import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateContractorBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

async function publish(type: string, ctx: RequestContext, id: string, payload: Record<string, unknown>): Promise<Accepted> {
  await queue.publish(type, {
    messageId: id, type,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload,
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createContractor(ctx: RequestContext, body: CreateContractorBody): Promise<Accepted> {
  const id = randomUUID();
  return publish(COMMANDS.contractorCreate, ctx, id, { id, tenantId: ctx.tenantId, ...body });
}

export async function rateContractor(ctx: RequestContext, contractorId: string, rating: number): Promise<Accepted> {
  const messageId = randomUUID();
  return publish(COMMANDS.contractorRate, ctx, messageId, {
    id: contractorId, tenantId: ctx.tenantId, rating,
  });
}
