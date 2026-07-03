import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateTemplateBody } from "./validators.js";
import type { TemplateView } from "./schema.js";

export type Accepted = { id: string; status: string; correlationId: string };

const RESOURCE = "template";

export async function createTemplate(ctx: RequestContext, body: CreateTemplateBody): Promise<Accepted> {
  const id = randomUUID();
  const projected: TemplateView = {
    id,
    tenantId: ctx.tenantId,
    type: body.type,
    name: body.name,
    htmlBody: body.htmlBody,
    variables: body.variables ?? null,
    version: 1,
  };

  await cache.put(cache.makeKey(ctx.tenantId, RESOURCE, id), projected);
  await queue.publish(COMMANDS.createTemplate, {
    messageId: id,
    type: COMMANDS.createTemplate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: projected,
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}
