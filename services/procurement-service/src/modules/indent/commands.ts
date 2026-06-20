import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateIndentBody, ApproveIndentBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createIndent(ctx: RequestContext, body: CreateIndentBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.indentCreate, {
    messageId: id, type: COMMANDS.indentCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function approveIndent(ctx: RequestContext, id: string, body: ApproveIndentBody): Promise<Accepted> {
  await queue.publish(COMMANDS.indentApprove, {
    type: COMMANDS.indentApprove,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "indent", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
