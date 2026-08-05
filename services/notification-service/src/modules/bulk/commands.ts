import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateCampaignBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createCampaign(ctx: RequestContext, body: CreateCampaignBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.createCampaign, {
    messageId: id, type: COMMANDS.createCampaign, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: {
      id, tenantId: ctx.tenantId,
      templateId: body.templateId, name: body.name, recipients: body.recipients,
      scheduledAt: body.scheduledAt,
      // Marketing fields. Money crosses the queue as a STRING (bigint paise) —
      // never a Number, so no float and no JSON bigint-serialisation problem.
      objective: body.objective ?? null,
      audienceSegmentId: body.audienceSegmentId ?? null,
      budgetMinor: body.budgetMinor ?? "0",
      currency: body.currency,
    },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function sendCampaign(ctx: RequestContext, id: string): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.sendCampaign, {
    messageId, type: COMMANDS.sendCampaign, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function cancelCampaign(ctx: RequestContext, id: string): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.cancelCampaign, {
    messageId, type: COMMANDS.cancelCampaign, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
