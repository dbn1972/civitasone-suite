/**
 * DM-001/002 documents — CQRS write path. Every mutation is keyed on the document
 * id so the four command topics never collide in `_inbox.processed`
 * (publishCrmCommand derives the messageId from `${type}:${id}`).
 */
import type { RequestContext } from "@civitasone/types";
import { COMMANDS } from "../../topics.js";
import { publishCrmCommand, type Accepted } from "../../shared/residual-publish.js";
import type { ConfirmBody, VerifyBody, ScanResultBody } from "./validators.js";

export type { Accepted };

/**
 * Confirm an uploaded object → create metadata (optionally superseding a prior
 * version). The new version's `lineageId`/`version` are computed atomically in the
 * consumer (inside the write transaction), never here, so two confirms racing on the
 * same lineage cannot both claim the same version.
 */
export const confirmDocument = (
  ctx: RequestContext,
  id: string,
  body: ConfirmBody,
): Promise<Accepted> =>
  publishCrmCommand(ctx, COMMANDS.confirmDocument, id, {
    subjectType: body.subjectType,
    subjectId: body.subjectId,
    docType: body.docType ?? null,
    title: body.title,
    filename: body.filename,
    storageKey: body.storageKey,
    storageProvider: body.storageProvider,
    mimeType: body.mimeType,
    sizeBytes: body.sizeBytes,
    checksum: body.checksum ?? null,
    supersedesId: body.supersedesId ?? null,
    expiryDate: body.expiryDate ?? null,
  });

export const deleteDocument = (ctx: RequestContext, id: string): Promise<Accepted> =>
  publishCrmCommand(ctx, COMMANDS.deleteDocument, id, {});

export const verifyDocument = (ctx: RequestContext, id: string, body: VerifyBody): Promise<Accepted> =>
  publishCrmCommand(ctx, COMMANDS.verifyDocument, id, {
    status: body.status,
    reason: body.reason ?? null,
  });

export const recordDocumentScan = (
  ctx: RequestContext,
  id: string,
  body: ScanResultBody,
): Promise<Accepted> =>
  publishCrmCommand(ctx, COMMANDS.recordDocumentScan, id, {
    scanStatus: body.scanStatus,
    detail: body.detail ?? null,
  });
