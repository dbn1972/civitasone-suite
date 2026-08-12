import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateShareBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function shareFile(ctx: RequestContext, body: CreateShareBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.shareCreate, {
    messageId: id, type: COMMANDS.shareCreate, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, ...body, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function revokeShare(ctx: RequestContext, shareId: string): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.shareRevoke, {
    messageId: id, type: COMMANDS.shareRevoke, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { shareId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
