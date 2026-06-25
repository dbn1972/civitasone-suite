import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateTemplateBody, SetPrefsBody, UpdatePrefsBody, UpdateTemplateBody } from "./validators.js";

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

// Update a single existing preference row's channels by id (tenant-scoped). The
// consumer mutates the row (only within ctx.tenantId) and audits via the outbox.
export async function updatePrefs(ctx: RequestContext, prefId: string, body: UpdatePrefsBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.updatePrefs, {
    messageId: id, type: COMMANDS.updatePrefs, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, prefId, ...body },
  });
  return { id: prefId, status: "accepted", correlationId: ctx.correlationId };
}
