import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { IndexDocumentBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function searchIndex(ctx: RequestContext, body: IndexDocumentBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.searchIndex, {
    messageId: id,
    type: COMMANDS.searchIndex,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function searchReindex(ctx: RequestContext): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.searchReindex, {
    messageId: id,
    type: COMMANDS.searchReindex,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { tenantId: ctx.tenantId },
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function removeDocument(ctx: RequestContext, documentId: string): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.searchRemoveDocument, {
    messageId: id,
    type: COMMANDS.searchRemoveDocument,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { documentId, tenantId: ctx.tenantId },
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}
