import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateAdvanceBody, CreateDebitNoteBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createAdvance(ctx: RequestContext, body: CreateAdvanceBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.advanceCreate, {
    messageId: id, type: COMMANDS.advanceCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createDebitNote(ctx: RequestContext, body: CreateDebitNoteBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.debitNoteCreate, {
    messageId: id, type: COMMANDS.debitNoteCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
