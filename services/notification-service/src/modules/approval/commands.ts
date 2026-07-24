import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function submitForReview(ctx: RequestContext, templateId: string): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.submitTemplate, {
    messageId, type: COMMANDS.submitTemplate, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { templateId, tenantId: ctx.tenantId, submittedBy: ctx.actorId },
  });
  return { id: templateId, status: "accepted", correlationId: ctx.correlationId };
}

export async function approve(ctx: RequestContext, templateId: string): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.approveTemplate, {
    messageId, type: COMMANDS.approveTemplate, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { templateId, tenantId: ctx.tenantId, approvedBy: ctx.actorId },
  });
  return { id: templateId, status: "accepted", correlationId: ctx.correlationId };
}

export async function reject(ctx: RequestContext, templateId: string, reason: string): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.rejectTemplate, {
    messageId, type: COMMANDS.rejectTemplate, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { templateId, tenantId: ctx.tenantId, rejectedBy: ctx.actorId, reason },
  });
  return { id: templateId, status: "accepted", correlationId: ctx.correlationId };
}

export async function publish(ctx: RequestContext, templateId: string): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.publishTemplate, {
    messageId, type: COMMANDS.publishTemplate, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { templateId, tenantId: ctx.tenantId, publishedBy: ctx.actorId },
  });
  return { id: templateId, status: "accepted", correlationId: ctx.correlationId };
}
