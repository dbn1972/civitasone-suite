import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, RESOURCE } from "../../topics.js";
import type { CreateDocumentBody } from "./validators.js";
import type { DocumentView } from "./schema.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createDocument(ctx: RequestContext, body: CreateDocumentBody): Promise<Accepted> {
  const id = randomUUID();
  const projected: DocumentView = {
    id,
    tenantId: ctx.tenantId,
    title: body.title,
    category: body.category ?? null,
    status: "draft",
    version: 1,
  };

  await cache.put(cache.makeKey(ctx.tenantId, RESOURCE, id), projected);
  await queue.publish(COMMANDS.createDocument, {
    messageId: id,
    type: COMMANDS.createDocument,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: projected,
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}
