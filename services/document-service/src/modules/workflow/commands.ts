import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateDakBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

function pub(type: string, tenantId: string, actorId: string, correlationId: string, payload: unknown): Accepted {
  const id = randomUUID();
  void queue.publish(type, { messageId: id, type, tenantId, actorId, correlationId, schemaVersion: "1.0", payload });
  return { id, status: "accepted", correlationId };
}

export function createDak(ctx: RequestContext, body: CreateDakBody): Accepted {
  const id = randomUUID();
  const payload = { id, tenantId: ctx.tenantId, ...body };
  void queue.publish(COMMANDS.dakCreate, { messageId: id, type: COMMANDS.dakCreate, tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export function forwardDak(ctx: RequestContext, dakId: string, assignedTo: string, asAdmin = false): Accepted {
  return pub(COMMANDS.dakForward, ctx.tenantId, ctx.actorId, ctx.correlationId, { dakId, assignedTo, asAdmin });
}

export function acknowledgeDak(ctx: RequestContext, dakId: string, asAdmin = false): Accepted {
  return pub(COMMANDS.dakAcknowledge, ctx.tenantId, ctx.actorId, ctx.correlationId, { dakId, asAdmin });
}

export function createNoting(ctx: RequestContext, dakId: string, body: string): Accepted {
  const id = randomUUID();
  const payload = { id, dakId, tenantId: ctx.tenantId, body };
  void queue.publish(COMMANDS.notingCreate, { messageId: id, type: COMMANDS.notingCreate, tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export function submitApproval(ctx: RequestContext, dakId: string): Accepted {
  // The returned id IS the approval row id (the consumer inserts it), so the client can decide it by that id.
  const id = randomUUID();
  void queue.publish(COMMANDS.approvalSubmit, { messageId: id, type: COMMANDS.approvalSubmit, tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload: { dakId, approvalId: id } });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export function decideApproval(ctx: RequestContext, approvalId: string, decision: string, remarks?: string | null, asAdmin = false): Accepted {
  return pub(COMMANDS.approvalDecide, ctx.tenantId, ctx.actorId, ctx.correlationId, { approvalId, decision, remarks, asAdmin });
}
