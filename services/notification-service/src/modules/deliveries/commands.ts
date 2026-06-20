import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { SendNotificationBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function sendNotification(ctx: RequestContext, body: SendNotificationBody): Promise<Accepted> {
  const id = randomUUID();
  const recipient = body.recipient ?? body.recipientId!;
  await queue.publish(COMMANDS.sendNotification, {
    messageId: id, type: COMMANDS.sendNotification, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { templateId: body.templateId, recipient, recipientId: body.recipientId, channel: body.channel, eventType: body.eventType, variables: body.variables },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
