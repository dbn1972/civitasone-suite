import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateDaRateBody } from "./api.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createDaRate(ctx: RequestContext, body: CreateDaRateBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.daRateCreate, {
    messageId: id, type: COMMANDS.daRateCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function deleteDaRate(ctx: RequestContext, rateId: string): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.daRateDelete, {
    messageId, type: COMMANDS.daRateDelete,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id: rateId, tenantId: ctx.tenantId },
  });
  return { id: rateId, status: "accepted", correlationId: ctx.correlationId };
}
