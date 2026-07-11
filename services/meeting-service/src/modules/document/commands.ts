/**
 * document module — command publishing helpers (CQRS write side).
 *
 * Routes (routes.ts) call these after zod validation to publish a write intent onto the
 * queue and return `202 Accepted` immediately — routes NEVER write to Postgres directly.
 *
 * Upload flow (Req 15.1, 15.2): the route has already size-/MIME-validated the decoded
 * bytes and staged them to object storage, so `documentUpload` carries only the small
 * metadata + `storageKey` pointer (never the file bytes). The `documentId` is minted by
 * the route (and doubles as the `messageId`) so the value is known synchronously, is
 * returned to the caller, and makes a command redelivery idempotent end-to-end
 * (`markProcessed(tx, messageId)` dedupes; the INSERT reuses the same primary key).
 *
 * The matching consumer handlers live in consumer.ts.
 *
 * _Requirements: 4.1, 15.1, 15.2, 15.4_
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

/** Standard 202-accepted result returned by every command helper. */
export type Accepted = { id: string; status: "accepted"; correlationId: string };

/** Common envelope scaffolding shared by every published command. */
function envelopeBase(ctx: RequestContext, messageId: string, type: string) {
  return {
    messageId,
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
  } as const;
}

/**
 * Metadata for a staged upload (bytes already in object storage at `storageKey`).
 * The route mints `documentId` up front (it needs it to build the `storageKey` under
 * which it stages the bytes), so the id is supplied here rather than minted in the helper.
 */
export interface DocumentUploadInput {
  documentId: string;
  meetingId: string;
  agendaItemId?: string | undefined;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  classification: string;
  documentType?: string | undefined;
  retentionYears?: number | undefined;
  previousVersionId?: string | undefined;
}

/**
 * Publish `document.upload`. Uses the route-minted `documentId` (also the messageId) so a
 * command redelivery is idempotent end-to-end; the consumer re-validates the MIME
 * server-side, computes the SHA-256 content hash, and INSERTs the metadata row.
 */
export async function documentUpload(ctx: RequestContext, input: DocumentUploadInput): Promise<Accepted> {
  const id = input.documentId;
  await queue.publish(COMMANDS.documentUpload, {
    ...envelopeBase(ctx, id, COMMANDS.documentUpload),
    payload: {
      documentId: id,
      tenantId: ctx.tenantId,
      meetingId: input.meetingId,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      storageKey: input.storageKey,
      classification: input.classification,
      ...(input.agendaItemId !== undefined ? { agendaItemId: input.agendaItemId } : {}),
      ...(input.documentType !== undefined ? { documentType: input.documentType } : {}),
      ...(input.retentionYears !== undefined ? { retentionYears: input.retentionYears } : {}),
      ...(input.previousVersionId !== undefined ? { previousVersionId: input.previousVersionId } : {}),
    },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Publish `document.remove` — a soft-delete (sets `deleted_at`, never a hard delete).
 * Optimistic-locked via `version`.
 */
export async function documentRemove(
  ctx: RequestContext,
  meetingId: string,
  documentId: string,
  version: number,
  reason?: string,
): Promise<Accepted> {
  await queue.publish(COMMANDS.documentRemove, {
    ...envelopeBase(ctx, randomUUID(), COMMANDS.documentRemove),
    payload: { documentId, meetingId, version, ...(reason !== undefined ? { reason } : {}) },
  });
  return { id: documentId, status: "accepted", correlationId: ctx.correlationId };
}
