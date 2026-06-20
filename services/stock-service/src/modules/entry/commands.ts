import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateEntryBody, PhysicalVerificationBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createEntry(ctx: RequestContext, body: CreateEntryBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.entryCreate, {
    messageId: id, type: COMMANDS.entryCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createPhysicalVerification(ctx: RequestContext, body: PhysicalVerificationBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.physicalCreate, {
    messageId: id, type: COMMANDS.physicalCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
