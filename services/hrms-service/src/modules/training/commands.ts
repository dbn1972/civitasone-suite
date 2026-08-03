import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateTrainingBody, CreateNominationBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createTraining(ctx: RequestContext, body: CreateTrainingBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.trainingCreate, {
    messageId: id, type: COMMANDS.trainingCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createNomination(ctx: RequestContext, body: CreateNominationBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.nominationCreate, {
    messageId: id, type: COMMANDS.nominationCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function completeNomination(
  ctx: RequestContext,
  id: string,
  body: { completedDate: string; result: string; score?: number | null; certificateRef?: string | null; trainingTitle?: string | null },
): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.nominationComplete, {
    messageId, type: COMMANDS.nominationComplete,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
