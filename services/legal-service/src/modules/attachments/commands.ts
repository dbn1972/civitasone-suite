import { createHash, randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

/** Deterministic UUID so a retried / re-observed transition dedups in the consumer. */
export function deterministicUuid(key: string): string {
  const h = createHash("sha256").update(`legal-attachment:${key}`).digest("hex").slice(0, 32).split("");
  h[12] = "5";
  h[16] = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  const s = h.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

const env = (ctx: RequestContext, type: string, messageId: string, payload: Record<string, unknown>) => ({
  messageId, type, tenantId: ctx.tenantId, actorId: ctx.actorId,
  correlationId: ctx.correlationId, schemaVersion: "1.0", payload,
});

export async function registerAttachment(ctx: RequestContext, p: {
  id: string; caseId: string; fileName: string; mimeType: string; sizeBytes: number; docBatchId: string; docFileId: string;
}): Promise<Accepted> {
  await queue.publish(COMMANDS.attachmentRegister, env(ctx, COMMANDS.attachmentRegister, p.id, { ...p, tenantId: ctx.tenantId }));
  return { id: p.id, status: "accepted", correlationId: ctx.correlationId };
}

export async function markUploaded(ctx: RequestContext, caseId: string, id: string): Promise<Accepted> {
  await queue.publish(COMMANDS.attachmentUploaded,
    env(ctx, COMMANDS.attachmentUploaded, deterministicUuid(`uploaded:${id}`), { id, caseId, tenantId: ctx.tenantId }));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/** Persist a document-service state observed on read. Deterministic per (attachment, status). */
export async function syncStatus(ctx: RequestContext, caseId: string, id: string, status: string, documentId: string | null): Promise<void> {
  await queue.publish(COMMANDS.attachmentSync,
    env(ctx, COMMANDS.attachmentSync, deterministicUuid(`sync:${id}:${status}`), { id, caseId, status, documentId, tenantId: ctx.tenantId }));
}

/** Audit that an affidavit was opened (the reveal). One per open, by the opener. */
export async function recordOpen(ctx: RequestContext, caseId: string, id: string, documentId: string): Promise<void> {
  await queue.publish(COMMANDS.attachmentOpen,
    env(ctx, COMMANDS.attachmentOpen, randomUUID(), { id, caseId, documentId, tenantId: ctx.tenantId }));
}
