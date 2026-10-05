import type { Queue } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import {
  LINK_TOPICS, scrubReasonText, linkRequestSchema, unlinkRequestSchema,
  type LinkResult, type UnlinkResult, type LinkReasonCode,
} from "@civitasone/scan-link";
import { z } from "zod";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { fileAcceptsDocuments, linkRefusedForClassification } from "./domain.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";
const SVC = "estab" as const;
export const SCAN_LINK_TOPICS = {
  request: LINK_TOPICS.request(SVC),
  result: LINK_TOPICS.result(SVC),
  unlinkRequest: LINK_TOPICS.unlinkRequest(SVC),
  unlinkResult: LINK_TOPICS.unlinkResult(SVC),
} as const;

type Tx = Parameters<typeof enqueue>[0];
type Env = { tenantId: string; actorId: string; correlationId: string };
const uuidSchema = z.string().uuid();

async function audit(
  tx: Tx, msg: Env, action: string, fileId: string,
  outcome: "success" | "rejected", metadata: Record<string, unknown>,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    // metadata carries ids / doc type / reason code only - never OCR text or PII values.
    payload: { service: SVC, action, resourceType: "file", resourceId: fileId, outcome, metadata },
  });
}

async function emitResult(tx: Tx, msg: Env, result: LinkResult): Promise<void> {
  await enqueue(tx, {
    topic: SCAN_LINK_TOPICS.result, eventType: SCAN_LINK_TOPICS.result,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: result,
  });
}

async function emitUnlinkResult(tx: Tx, msg: Env, result: UnlinkResult): Promise<void> {
  await enqueue(tx, {
    topic: SCAN_LINK_TOPICS.unlinkResult, eventType: SCAN_LINK_TOPICS.unlinkResult,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: result,
  });
}

export function registerScanLinkConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  // ── link ────────────────────────────────────────────────────────────────
  queue.subscribe(SCAN_LINK_TOPICS.request, async (msg) => {
    const parsed = linkRequestSchema.safeParse(msg.payload);
    if (!parsed.success) throw new NonRetryableError("invalid estab.scan-link.request payload");
    const req = parsed.data;
    const env: Env = { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
    let touchedFile: string | null = null;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const base = { linkId: req.linkId, target: req.target, targetId: req.targetId, documentId: req.document.documentId };
      const reject = async (reason: LinkReasonCode, fileId: string | null): Promise<void> => {
        if (fileId) {
          await audit(tx, env, "attach_scanned_document_rejected", fileId, "rejected",
            { linkId: req.linkId, documentId: req.document.documentId, reason });
        }
        await emitResult(tx, env, { ...base, status: "rejected", reason });
      };

      if (req.target !== "eoffice_file") return reject("TARGET_KIND_MISMATCH", null);
      if (!uuidSchema.safeParse(req.targetId).success) return reject("TARGET_NOT_FOUND", null);

      // RE-CHECK inside the tx: the eFile must exist in THIS tenant (RLS + explicit predicate) ...
      const file = await repo.findFileTx(tx, req.targetId, msg.tenantId);
      if (!file) return reject("TARGET_NOT_FOUND", null);

      // Maker != checker, re-checked on the TARGET side (defence in depth; the document side enforces it too).
      // approvedBy is null only when filing maker-checker is off, in which case there is no checker to compare.
      if (req.approvedBy !== null && req.approvedBy === req.requestedBy) return reject("MAKER_CHECKER_VIOLATION", file.id);

      // Idempotent redelivery (a new messageId for the same linkId): re-emit the recorded outcome.
      const existing = await repo.findByLinkIdTx(tx, req.linkId, msg.tenantId);
      if (existing) {
        if (existing.state === "linked" && existing.fileId === file.id) {
          return emitResult(tx, env, { ...base, status: "linked", reason: null });
        }
        return emitResult(tx, env, { ...base, status: "rejected", reason: "LINK_ALREADY_UNLINKED" });
      }

      if (linkRefusedForClassification(file.classification)) return reject("TARGET_CLASSIFIED", file.id);

      // ... and in a state that accepts documents.
      if (!fileAcceptsDocuments(file.status)) return reject("FILE_CLOSED", file.id);

      if (await repo.findActiveForDocumentTx(tx, file.id, req.document.documentId, msg.tenantId)) {
        return reject("DOCUMENT_ALREADY_LINKED", file.id);
      }

      const d = req.document;
      const inserted = await repo.insertLinkTx(tx, {
        tenantId: msg.tenantId, fileId: file.id, documentId: d.documentId, batchId: d.batchId,
        fileName: d.fileName, mimeType: d.mimeType, docType: d.docType, pageCount: d.pageCount,
        ocrConfidence: d.ocrConfidence === null ? null : d.ocrConfidence.toFixed(4),
        piiFlags: d.piiFlags, textPreviewMasked: d.textPreviewMasked,
        linkId: req.linkId, linkedBy: req.requestedBy, approvedBy: req.approvedBy,
        filedAt: new Date(d.filedAt), createdBy: req.requestedBy, updatedBy: req.requestedBy,
      });
      if (!inserted) return emitResult(tx, env, { ...base, status: "linked", reason: null }); // lost a link_id race
      await audit(tx, env, "attach_scanned_document", file.id, "success", {
        linkId: req.linkId, documentId: d.documentId, batchId: d.batchId, docType: d.docType,
        pageCount: d.pageCount, piiFlags: d.piiFlags, approvedBy: req.approvedBy,
      });
      await emitResult(tx, env, { ...base, status: "linked", reason: null });
      touchedFile = file.id;
    });
    if (touchedFile) await cache.invalidate(cache.makeKey(msg.tenantId, "file", touchedFile));
  });

  // ── unlink (reason mandatory, audited) ──────────────────────────────────
  queue.subscribe(SCAN_LINK_TOPICS.unlinkRequest, async (msg) => {
    const parsed = unlinkRequestSchema.safeParse(msg.payload);
    if (!parsed.success) throw new NonRetryableError("invalid estab.scan-link.unlink.request payload");
    const req = parsed.data;
    const env: Env = { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
    let touchedFile: string | null = null;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const res = (status: UnlinkResult["status"], reason: LinkReasonCode | null): Promise<void> =>
        emitUnlinkResult(tx, env, { linkId: req.linkId, documentId: req.documentId, status, reason });

      const row = await repo.findByLinkIdTx(tx, req.linkId, msg.tenantId);
      if (!row || row.documentId !== req.documentId || req.target !== "eoffice_file" || row.fileId !== req.targetId) {
        return res("rejected", "LINK_NOT_FOUND");
      }
      if (row.state === "unlinked") return res("unlinked", null); // idempotent
      // The table and the audit never hold raw PII a clerk may have typed into the reason.
      const safeReason = scrubReasonText(req.reason);
      const flipped = await repo.markUnlinkedTx(tx, {
        linkId: req.linkId, tenantId: msg.tenantId, reason: safeReason, actorId: req.requestedBy,
      });
      if (flipped) {
        await audit(tx, env, "detach_scanned_document", row.fileId, "success",
          { linkId: req.linkId, documentId: req.documentId, reason: safeReason });
        touchedFile = row.fileId;
      }
      await res("unlinked", null);
    });
    if (touchedFile) await cache.invalidate(cache.makeKey(msg.tenantId, "file", touchedFile));
  });
}
