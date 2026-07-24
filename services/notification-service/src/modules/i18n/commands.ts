import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export interface CreateLocaleVariantPayload {
  templateId: string;
  locale: string;
  subject?: string | undefined;
  body: string;
}

export interface UpdateLocaleVariantPayload {
  subject?: string | undefined;
  body?: string | undefined;
  status?: string | undefined;
}

export async function createLocaleVariant(ctx: RequestContext, payload: CreateLocaleVariantPayload): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.createLocaleVariant, {
    messageId: id, type: COMMANDS.createLocaleVariant, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...payload },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateLocaleVariant(ctx: RequestContext, id: string, payload: UpdateLocaleVariantPayload): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.updateLocaleVariant, {
    messageId, type: COMMANDS.updateLocaleVariant, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...payload },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
