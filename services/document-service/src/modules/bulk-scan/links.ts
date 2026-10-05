/** Pure link helpers: target validation, finance match hint, the document meta sent to a target service. */
import { LINK_TARGETS, TARGET_SERVICE, linkedDocumentMetaSchema, financeMatchHintSchema, type LinkTarget, type LinkedDocumentMeta, type FinanceMatchHint } from "@civitasone/scan-link";
import type { BatchFileRow, BatchRow } from "./schema.js";

export { LINK_TARGETS, TARGET_SERVICE };
export type { LinkTarget };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** All five target kinds identify their record by its uuid. Syntactic check only; the target service re-checks in its own tx. */
export function isValidTargetId(target: LinkTarget, targetId: string): boolean {
  void target;
  return UUID_RE.test(targetId);
}

export const isFinanceTarget = (t: LinkTarget): boolean => t.startsWith("finance_");

interface FieldLike { kind: string; value: string; confidence?: number }

function best(fields: readonly FieldLike[], kinds: readonly string[]): FieldLike | null {
  let out: FieldLike | null = null;
  for (const f of fields) {
    if (!kinds.includes(f.kind)) continue;
    if (!out || (f.confidence ?? 0) > (out.confidence ?? 0)) out = f;
  }
  return out;
}

/** Reference (voucher / reference number) + amount in paise taken from the extracted fields (highest confidence wins). */
export function financeHintFromFields(fields: readonly FieldLike[] | null | undefined): FinanceMatchHint {
  const list = fields ?? [];
  const ref = best(list, ["voucher_no", "reference_no"]);
  const amt = best(list, ["amount_inr"]);
  return financeMatchHintSchema.parse({
    reference: ref ? ref.value.slice(0, 100) : null,
    amountMinor: amt && /^\d{1,18}$/.test(amt.value) ? amt.value : null,
  });
}

/** Masked, PII-safe metadata the target stores to render its "Scanned documents" section. */
export function buildLinkedDocumentMeta(file: BatchFileRow, batch: Pick<BatchRow, "id"> , documentId: string, filedAt: Date): LinkedDocumentMeta {
  return linkedDocumentMetaSchema.parse({
    documentId, batchId: batch.id, fileName: file.originalName.slice(0, 500), mimeType: file.mimeType ?? null,
    docType: (file.docType ?? "other").slice(0, 64), pageCount: file.pageCount ?? 0,
    ocrConfidence: file.ocrMeanConfidence === null || file.ocrMeanConfidence === undefined ? null : Number(file.ocrMeanConfidence),
    piiFlags: (file.piiFlags ?? []).slice(0, 20).map((s) => s.slice(0, 32)),
    textPreviewMasked: file.searchText ? file.searchText.slice(0, 500) : null,
    filedAt: filedAt.toISOString(),
  });
}

/** Link states in which the (file, target) pair is spoken for. */
export const ACTIVE_LINK_STATES = ["requested", "awaiting_approval", "linked", "flagged_mismatch", "unlink_requested"] as const;
/** States in which the file's filing is waiting on the link (file stays ready_to_file). */
export const PENDING_LINK_STATES = ["requested", "awaiting_approval"] as const;
