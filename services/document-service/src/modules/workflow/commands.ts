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

export function forwardDak(ctx: RequestContext, dakId: string, assignedTo: string): Accepted {
  return pub(COMMANDS.dakForward, ctx.tenantId, ctx.actorId, ctx.correlationId, { dakId, assignedTo });
}

export function acknowledgeDak(ctx: RequestContext, dakId: string): Accepted {
  return pub(COMMANDS.dakAcknowledge, ctx.tenantId, ctx.actorId, ctx.correlationId, { dakId });
}

export function createNoting(ctx: RequestContext, dakId: string, body: string): Accepted {
  const id = randomUUID();
  const payload = { id, dakId, tenantId: ctx.tenantId, body };
  void queue.publish(COMMANDS.notingCreate, { messageId: id, type: COMMANDS.notingCreate, tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export function submitApproval(ctx: RequestContext, dakId: string): Accepted {
  return pub(COMMANDS.approvalSubmit, ctx.tenantId, ctx.actorId, ctx.correlationId, { dakId });
}

export function decideApproval(ctx: RequestContext, approvalId: string, decision: string, remarks?: string | null): Accepted {
  return pub(COMMANDS.approvalDecide, ctx.tenantId, ctx.actorId, ctx.correlationId, { approvalId, decision, remarks });
}
