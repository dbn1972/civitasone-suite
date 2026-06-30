import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import type { AddCorrespondenceBody, MarkPucBody } from "./validators.js";

/**
 * Command topics for the correspondence module. Defined locally (not imported
 * from ../../topics.ts) so this module stays self-contained for the compliance
 * remediation. These literals must match the consumer's COMMANDS object.
 */
export const COMMANDS = {
  correspondenceAdd: "estab.correspondence.add",
  pucMark:           "estab.file.puc.mark",
  pucUnmark:         "estab.file.puc.unmark",
} as const;

export type Accepted = { id: string; status: string; correlationId: string };

export async function addCorrespondence(
  ctx: RequestContext,
  fileId: string,
  body: AddCorrespondenceBody,
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.correspondenceAdd, {
    messageId: id, type: COMMANDS.correspondenceAdd,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, fileId, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "file", fileId));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function markPuc(
  ctx: RequestContext,
  fileId: string,
  body: MarkPucBody,
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.pucMark, {
    messageId: id, type: COMMANDS.pucMark,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, fileId, tenantId: ctx.tenantId, correspondenceId: body.correspondenceId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "file", fileId));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function unmarkPuc(
  ctx: RequestContext,
  fileId: string,
  correspondenceId: string,
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.pucUnmark, {
    messageId: id, type: COMMANDS.pucUnmark,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, fileId, tenantId: ctx.tenantId, correspondenceId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "file", fileId));
  return { id: correspondenceId, status: "accepted", correlationId: ctx.correlationId };
}
