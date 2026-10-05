/**
 * Filing: turn a reviewed / auto-approved scan into a document in the document module.
 *
 *   prepareFilingText()  IO (object store) done BEFORE the transaction: writes the reviewed final text object when a
 *                        reviewer edited the OCR text, and computes the bounded masked search snippet.
 *   fileDocument()       one transaction step: conditional ready_to_file -> filed, FilingPort.create (document.files +
 *                        file_versions), domain event, audit event, search-index event. Idempotent: the document id is
 *                        deterministic per file, the transition is conditional, create() ignores an existing document.
 *
 * bulk-scan never imports the files module: document creation goes through the injected FilingPort.
 */
import { publishSearchIndex } from "@civitasone/search";
import { EVENTS } from "../../topics.js";
import { emitAudit, emitEvent, type EventCtx } from "./emit.js";
import { getPorts } from "./ports.js";
import { documentIdFor } from "./ids.js";
import { isTenantKey, keys } from "./keys.js";
import { composeFinalText, snippetOf } from "./review-view.js";
import * as repo from "./repo.js";
import type { BatchFileRow, BatchRow } from "./schema.js";

export interface PreparedText { finalTextKey: string | null; searchText: string }

/** Object-store IO for filing (outside any transaction). Throws a plain Error on a storage failure (retried). */
export async function prepareFilingText(file: BatchFileRow): Promise<PreparedText> {
  const store = getPorts().store;
  const overrides = file.reviewOverrides?.pages ?? {};
  let text = "";
  let finalTextKey: string | null = file.finalTextKey ?? null;
  if (Object.keys(overrides).length > 0 && file.structuredJsonKey && isTenantKey(file.tenantId, file.structuredJsonKey)) {
    const sj = JSON.parse((await store.get(file.structuredJsonKey)).toString("utf8")) as unknown;
    text = composeFinalText(sj, overrides);
    finalTextKey = keys.textFinal(file.tenantId, file.batchId, file.id);
    await store.put(finalTextKey, text, "text/plain; charset=utf-8");
  } else if (file.textMaskedKey && isTenantKey(file.tenantId, file.textMaskedKey)) {
    text = (await store.get(file.textMaskedKey)).toString("utf8");
    finalTextKey = null;
  }
  return { finalTextKey, searchText: snippetOf(text) };
}

export interface FileDocumentArgs {
  file: BatchFileRow;
  batch: Pick<BatchRow, "id" | "targetFolderId">;
  /** Who is filing: the approving reviewer (no link) or the user whose approval completed the link flow. */
  actorId: string;
  now: Date;
  /** why: AUTO_APPROVED | REVIEW_APPROVED | LINK_CONFIRMED (file_events reason + audit detail) */
  reason: string;
}

/**
 * ready_to_file -> filed inside the caller's transaction. Returns false when someone else already moved the file
 * (redelivery / race): the caller then drops its work.
 */
export async function fileDocument(tx: repo.Writer, c: EventCtx, a: FileDocumentArgs): Promise<boolean> {
  const f = a.file;
  const documentId = documentIdFor(f.id);
  const moved = await repo.transition(tx, {
    tenantId: f.tenantId, fileId: f.id, from: ["ready_to_file"], to: "filed", actorId: a.actorId, reason: a.reason, now: a.now,
    patch: { filedDocumentId: documentId, filedAt: a.now },
    detail: { documentId },
  });
  if (!moved) return false;

  await getPorts().filing.create(tx, {
    tenantId: f.tenantId, documentId, actorId: a.actorId, folderId: a.batch.targetFolderId ?? null,
    name: f.originalName, mimeType: f.mimeType, sizeBytes: f.sizeBytes, tags: f.tags,
    originalKey: f.storageKey, searchablePdfKey: f.searchablePdfKey, textKey: f.finalTextKey ?? f.textMaskedKey, structuredJsonKey: f.structuredJsonKey,
  });

  await emitEvent(tx, c, EVENTS.bulkFileFiled, { fileId: f.id, batchId: f.batchId, documentId, docType: f.docType });
  await emitAudit(tx, c, {
    action: "file_filed", resourceType: "bulk_scan_file", resourceId: f.id,
    details: { documentId, batchId: f.batchId, docType: f.docType, reason: a.reason, pageCount: f.pageCount },
  });
  // Masked snippet only (never raw OCR text). The central search consumer decides whether an engine is configured.
  await publishSearchIndex(tx as unknown as Parameters<typeof publishSearchIndex>[0], {
    id: documentId, tenantId: f.tenantId, module: "document", name: f.originalName, description: (f.searchText ?? "").slice(0, 500),
    status: "filed", action: "upsert", actorId: a.actorId, correlationId: c.correlationId,
  });
  return true;
}

/** Remove a document from the search index (retention). Same outbox event, action delete. */
export async function unindexDocument(tx: repo.Writer, c: EventCtx, f: Pick<BatchFileRow, "tenantId" | "originalName">, documentId: string, actorId: string): Promise<void> {
  await publishSearchIndex(tx as unknown as Parameters<typeof publishSearchIndex>[0], {
    id: documentId, tenantId: f.tenantId, module: "document", name: f.originalName, status: "deleted", action: "delete", actorId, correlationId: c.correlationId,
  });
}
