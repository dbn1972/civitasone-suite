import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export interface SetDndWindowPayload {
  userId: string;
  startTime: string;
  endTime: string;
  timezone: string;
  days?: string[];
}

export interface UpdateDndWindowPayload {
  startTime?: string;
  endTime?: string;
  timezone?: string;
  days?: string[];
  enabled?: boolean;
}

export async function setDndWindow(ctx: RequestContext, payload: SetDndWindowPayload): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.setDndWindow, {
    messageId: id, type: COMMANDS.setDndWindow, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...payload },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateDndWindow(ctx: RequestContext, id: string, payload: UpdateDndWindowPayload): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.updateDndWindow, {
    messageId, type: COMMANDS.updateDndWindow, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...payload },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
