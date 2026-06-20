import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateTemplateBody, SetPrefsBody, UpdateTemplateBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createTemplate(ctx: RequestContext, body: CreateTemplateBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.createTemplate, {
    messageId: id, type: COMMANDS.createTemplate, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateTemplate(ctx: RequestContext, templateId: string, body: UpdateTemplateBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.updateTemplate, {
    messageId: id, type: COMMANDS.updateTemplate, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, templateId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function setPrefs(ctx: RequestContext, userId: string, body: SetPrefsBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.setPrefs, {
    messageId: id, type: COMMANDS.setPrefs, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, userId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
