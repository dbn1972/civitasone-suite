import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createChecklist(
  ctx: RequestContext,
  body: { title: string; description?: string | null; items: string[] },
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.checklistCreate, {
    messageId: id,
    type: COMMANDS.checklistCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id,
      tenantId: ctx.tenantId,
      title: body.title,
      description: body.description ?? null,
      items: body.items,
    },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function completeChecklist(
  ctx: RequestContext,
  id: string,
  version: number,
): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.checklistComplete, {
    messageId,
    type: COMMANDS.checklistComplete,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, version },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
