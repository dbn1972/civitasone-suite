import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export interface ScheduleNotificationPayload {
  templateId: string;
  recipient: string;
  recipientId?: string;
  channel: string;
  priority?: string;
  variables?: Record<string, unknown>;
  scheduledAt: string;
}

export async function scheduleNotification(ctx: RequestContext, payload: ScheduleNotificationPayload): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.scheduleNotification, {
    messageId: id, type: COMMANDS.scheduleNotification, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...payload },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function cancelSchedule(ctx: RequestContext, id: string): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.cancelSchedule, {
    messageId, type: COMMANDS.cancelSchedule, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
