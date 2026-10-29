import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateDakBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

async function pub(type: string, tenantId: string, actorId: string, correlationId: string, payload: unknown): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(type, { messageId: id, type, tenantId, actorId, correlationId, schemaVersion: "1.0", payload });
  return { id, status: "accepted", correlationId };
}

export async function createDak(ctx: RequestContext, body: CreateDakBody): Promise<Accepted> {
  const id = randomUUID();
  const payload = { id, tenantId: ctx.tenantId, ...body };
  await queue.publish(COMMANDS.dakCreate, { messageId: id, type: COMMANDS.dakCreate, tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function forwardDak(ctx: RequestContext, dakId: string, assignedTo: string, asAdmin = false, remarks?: string | null): Promise<Accepted> {
  return pub(COMMANDS.dakForward, ctx.tenantId, ctx.actorId, ctx.correlationId, { dakId, assignedTo, asAdmin, ...(remarks ? { remarks } : {}) });
}

export async function acknowledgeDak(ctx: RequestContext, dakId: string, asAdmin = false): Promise<Accepted> {
  return pub(COMMANDS.dakAcknowledge, ctx.tenantId, ctx.actorId, ctx.correlationId, { dakId, asAdmin });
}

export async function createNoting(ctx: RequestContext, dakId: string, body: string): Promise<Accepted> {
  const id = randomUUID();
  const payload = { id, dakId, tenantId: ctx.tenantId, body };
  await queue.publish(COMMANDS.notingCreate, { messageId: id, type: COMMANDS.notingCreate, tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function submitApproval(ctx: RequestContext, dakId: string): Promise<Accepted> {
  // The returned id IS the approval row id (the consumer inserts it), so the client can decide it by that id.
  const id = randomUUID();
  await queue.publish(COMMANDS.approvalSubmit, { messageId: id, type: COMMANDS.approvalSubmit, tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { dakId, approvalId: id } });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function decideApproval(ctx: RequestContext, approvalId: string, decision: string, remarks?: string | null, asAdmin = false): Promise<Accepted> {
  return pub(COMMANDS.approvalDecide, ctx.tenantId, ctx.actorId, ctx.correlationId, { approvalId, decision, remarks, asAdmin });
}
