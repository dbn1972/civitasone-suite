import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateObservationBody, DraftParaBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createObservation(ctx: RequestContext, body: CreateObservationBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.observationCreate, {
    messageId: id, type: COMMANDS.observationCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function draftPara(ctx: RequestContext, observationId: string, body: DraftParaBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.paraDraft, {
    messageId: id, type: COMMANDS.paraDraft,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, observationId, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
