/**
 * Review + filing + link-decision command consumers. Same contract as consumer.ts: each handler is
 * markProcessed -> business write -> audit.event.record outbox event in ONE db.transaction; external I/O (object
 * store, OCR masking) happens BEFORE the transaction; permanent business rejections throw NonRetryableError.
 */
import { z } from "zod";
import { scrubReasonText } from "@civitasone/scan-link";
import { NonRetryableError, type Queue, type CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import * as repo from "./repo.js";
import * as rrepo from "./review-repo.js";
import { emitAudit, emitEvent, type EventCtx } from "./emit.js";
import { fileDocument, prepareFilingText } from "./filing.js";
import { publishLinkRequest, publishUnlinkRequest, returnFileToReview } from "./link-flow.js";
import { ACTIVE_LINK_STATES, financeHintFromFields, isFinanceTarget, isValidTargetId } from "./links.js";
import { applyFieldEdits, auditFields, auditTextEdit, normalizeFieldValue, type StoredField } from "./review-edit.js";
import { editFields, linkRefSchema } from "./review-validators.js";
import { detectPii, maskText } from "./ocr-contract.js";
import { documentIdFor } from "./ids.js";
import { getFileTx } from "./repo.js";

const ctxOf = (m: CommandEnvelope): EventCtx => ({ tenantId: m.tenantId, actorId: m.actorId, correlationId: m.correlationId });
const reject = (code: string, msg?: string): never => { throw new NonRetryableError(code + (msg ? ": " + msg : "")); };

const editPayload = editFields.extend({ fileId: z.string().uuid() }).strict();
const approvePayload = z.object({ fileId: z.string().uuid(), linkId: z.string().uuid(), expectedVersion: z.number().int().min(1), link: linkRefSchema.optional() });
const rejectPayload = z.object({ fileId: z.string().uuid(), expectedVersion: z.number().int().min(1), reason: z.string().min(5).max(500) });
const linkIdPayload = z.object({ linkId: z.string().uuid() });
const linkReasonPayload = z.object({ linkId: z.string().uuid(), reason: z.string().min(3).max(500) });
const unlinkPayload = z.object({ linkId: z.string().uuid(), reason: z.string().min(5).max(500) });

function parse<T>(schema: z.ZodType<T>, payload: unknown): T {
  const r = schema.safeParse(payload);
  if (!r.success) return reject("INVALID_PAYLOAD");
  return r.data;
}

export function registerReviewConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  // ── edit ─────────────────────────────────────────────────────
  queue.subscribe<unknown>(COMMANDS.bulkReviewEdit, async (msg) => {
    const p = parse(editPayload, msg.payload);
    const file0 = await repo.getFile(msg.tenantId, p.fileId);
    if (!file0) return reject("FILE_NOT_FOUND");
    const batch = await repo.getBatch(msg.tenantId, file0.batchId);
    const eff = await repo.resolveEffectiveSettings(msg.tenantId, batch?.profileId ?? null);
    if (p.docType && !eff.settings.classification.docTypes.some((d) => d.id === p.docType)) return reject("UNKNOWN_DOC_TYPE");
    for (const f of p.fields ?? []) if (normalizeFieldValue(f.kind, f.value) === null) return reject("INVALID_FIELD_VALUE", f.kind);

    // Reviewer text is typed over MASKED text, but they may still type raw PII: re-mask under the tenant policy BEFORE storing.
    const maskedText = (p.text ?? []).map((t) => {
      const findings = detectPii([{ pageNumber: t.pageNumber, text: t.text }], undefined, eff.settings.pii.policy);
      return { pageNumber: t.pageNumber, text: maskText(t.text, findings, t.pageNumber) };
    });

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const file = await getFileTx(tx, msg.tenantId, p.fileId);
      if (!file) return reject("FILE_NOT_FOUND");
      if (file.state !== "needs_review") return reject("NOT_REVIEWABLE", file.state);
      if (file.version !== p.expectedVersion) return reject("STALE_VERSION");

      const oldFields = (file.extractedFields ?? []) as StoredField[];
      const set: Partial<typeof file> = {};
      const oldValue: Record<string, unknown> = {};
      const newValue: Record<string, unknown> = {};
      if (p.docType !== undefined && p.docType !== file.docType) { set.docType = p.docType; oldValue.docType = file.docType; newValue.docType = p.docType; }
      if (p.tags !== undefined) { set.tags = p.tags; oldValue.tags = file.tags; newValue.tags = p.tags; }
      if (p.fields !== undefined) {
        const next = applyFieldEdits(oldFields, p.fields);
        set.extractedFields = next as unknown[];
        oldValue.fields = auditFields(oldFields);
        newValue.fields = auditFields(next);
      }
      if (maskedText.length > 0) {
        const pages = { ...(file.reviewOverrides?.pages ?? {}) };
        for (const t of maskedText) pages[String(t.pageNumber)] = t.text;
        set.reviewOverrides = { pages };
        oldValue.text = { overriddenPages: Object.keys(file.reviewOverrides?.pages ?? {}).length };
        newValue.text = maskedText.map((t) => auditTextEdit(t.pageNumber, t.text));
      }
      const ok = await rrepo.patchFileVersioned(tx, { tenantId: msg.tenantId, fileId: p.fileId, states: ["needs_review"], expectedVersion: p.expectedVersion, actorId: msg.actorId, set });
      if (!ok) return reject("STALE_VERSION");
      await emitAudit(tx, ctxOf(msg), {
        action: "review_edit", resourceType: "bulk_scan_file", resourceId: p.fileId,
        details: { batchId: file.batchId, changed: Object.keys(newValue) }, oldValue, newValue,
      });
    });
  });

  // ── approve (file now, or request a link) ────────────────────
  queue.subscribe<unknown>(COMMANDS.bulkReviewApprove, async (msg) => {
    const p = parse(approvePayload, msg.payload);
    const file0 = await repo.getFile(msg.tenantId, p.fileId);
    if (!file0) return reject("FILE_NOT_FOUND");
    const batch = await repo.getBatch(msg.tenantId, file0.batchId);
    if (!batch) return reject("BATCH_NOT_FOUND");
    if (p.link && !isValidTargetId(p.link.target, p.link.targetId)) return reject("INVALID_LINK_TARGET");
    // State / version are judged INSIDE the tx after markProcessed, so a redelivery of an already-applied command is a
    // silent no-op instead of a (misleading) rejection. Storage IO is skipped when the file is plainly not approvable.
    const approvable = (file0.state === "needs_review" || file0.state === "ready_to_file") && file0.version === p.expectedVersion;
    const prepared = approvable ? await prepareFilingText(file0) : null;           // object-store IO, outside the tx
    const c = ctxOf(msg);
    const now = new Date();

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      if (!approvable || !prepared) return reject(file0.version !== p.expectedVersion ? "STALE_VERSION" : "NOT_REVIEWABLE", file0.state);
      const cfg = (await repo.currentSettingsTx(tx, msg.tenantId)).settings;
      if (p.link && !cfg.allowedLinkTargets.includes(p.link.target)) return reject("LINK_TARGET_NOT_ALLOWED", p.link.target);
      if (p.link) {
        const existing = await rrepo.linksForFileTx(tx, msg.tenantId, p.fileId);
        if (existing.some((l) => (ACTIVE_LINK_STATES as readonly string[]).includes(l.state) && l.state !== "flagged_mismatch")) return reject("LINK_ALREADY_ACTIVE");
      }
      const reviewed = { reviewedBy: msg.actorId, reviewedAt: now, finalTextKey: prepared.finalTextKey, searchText: prepared.searchText };
      const auto = file0.state === "ready_to_file";
      const moved = auto
        ? await rrepo.patchFileVersioned(tx, { tenantId: msg.tenantId, fileId: p.fileId, states: ["ready_to_file"], expectedVersion: p.expectedVersion, actorId: msg.actorId, set: reviewed })
        : await repo.transition(tx, {
          tenantId: msg.tenantId, fileId: p.fileId, from: ["needs_review"], to: "ready_to_file", actorId: msg.actorId,
          reason: "REVIEW_APPROVED", patch: reviewed, expectedVersion: p.expectedVersion, now,
        });
      if (!moved) return reject("STALE_VERSION");
      const file = await getFileTx(tx, msg.tenantId, p.fileId);
      if (!file) return reject("FILE_NOT_FOUND");

      if (!p.link) {
        if (!(await fileDocument(tx, c, { file, batch, actorId: msg.actorId, now, reason: auto ? "AUTO_APPROVED" : "REVIEW_APPROVED" }))) return reject("NOT_FILEABLE");
        await emitAudit(tx, c, { action: "review_approved", resourceType: "bulk_scan_file", resourceId: p.fileId, details: { batchId: file.batchId, linked: false, documentId: documentIdFor(file.id) } });
        return;
      }

      const makerChecker = cfg.filingMakerChecker;
      const link = {
        id: p.linkId, tenantId: msg.tenantId, fileId: p.fileId, documentId: documentIdFor(file.id), target: p.link.target, targetId: p.link.targetId,
        state: makerChecker ? "awaiting_approval" : "requested", requestedBy: msg.actorId, approvedBy: null,
        financeHint: isFinanceTarget(p.link.target) ? (financeHintFromFields(file.extractedFields as StoredField[] | null) as unknown as Record<string, unknown>) : null,
      };
      await rrepo.insertLink(tx, link);
      if (!makerChecker) await publishLinkRequest(tx, c, { link, approvedBy: null, file, batch, now });
      await emitAudit(tx, c, {
        action: "review_approved", resourceType: "bulk_scan_file", resourceId: p.fileId,
        details: { batchId: file.batchId, linked: true, linkId: p.linkId, target: p.link.target, targetId: p.link.targetId, linkState: link.state },
      });
    });
  });

  // ── reject ───────────────────────────────────────────────────
  queue.subscribe<unknown>(COMMANDS.bulkReviewReject, async (msg) => {
    const p = parse(rejectPayload, msg.payload);
    const reason = scrubReasonText(p.reason);   // free text: Aadhaar / phone / PAN / email never reach the DB, the outbox or the audit trail
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const file = await getFileTx(tx, msg.tenantId, p.fileId);
      if (!file) return reject("FILE_NOT_FOUND");
      if (file.version !== p.expectedVersion) return reject("STALE_VERSION");
      const ok = await repo.transition(tx, {
        tenantId: msg.tenantId, fileId: p.fileId, from: ["needs_review"], to: "skipped", actorId: msg.actorId, reason: "REVIEW_REJECTED",
        patch: { reviewedBy: msg.actorId, reviewedAt: new Date() }, detail: { reason }, expectedVersion: p.expectedVersion,
      });
      if (!ok) return reject("NOT_REVIEWABLE", file.state);
      await emitAudit(tx, ctxOf(msg), { action: "review_rejected", resourceType: "bulk_scan_file", resourceId: p.fileId, details: { batchId: file.batchId, reason } });
    });
  });

  // ── link decisions (maker-checker) ───────────────────────────
  queue.subscribe<unknown>(COMMANDS.bulkLinkApprove, async (msg) => {
    const p = parse(linkIdPayload, msg.payload);
    const c = ctxOf(msg);
    const now = new Date();
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Serialise concurrent approvers of the same link; the conditional UPDATE below then has exactly one winner.
      await repo.advisoryXactLock(tx, "bulk_scan_link:" + p.linkId);
      const won = await rrepo.moveLink(tx, { tenantId: msg.tenantId, linkId: p.linkId, from: ["awaiting_approval"], to: "requested", notRequestedBy: msg.actorId, setApprovedBy: msg.actorId });
      if (!won) {
        const cur = await rrepo.getLinkTx(tx, msg.tenantId, p.linkId);
        if (!cur) return reject("LINK_NOT_FOUND");
        if (cur.state !== "awaiting_approval") return reject("NOT_PENDING", cur.state);
        return reject("MAKER_CHECKER_VIOLATION");
      }
      const cfg = (await repo.currentSettingsTx(tx, msg.tenantId)).settings;
      if (!cfg.allowedLinkTargets.includes(won.target as never)) return reject("LINK_TARGET_NOT_ALLOWED", won.target);
      const file = await getFileTx(tx, msg.tenantId, won.fileId);
      const batch = file ? await repo.getBatchTx(tx, msg.tenantId, file.batchId) : null;
      if (!file || !batch) return reject("FILE_NOT_FOUND");
      if (file.state !== "ready_to_file") return reject("FILE_NOT_PENDING", file.state);
      await publishLinkRequest(tx, c, { link: won, approvedBy: msg.actorId, file, batch, now });
      await emitAudit(tx, c, { action: "link_approved", resourceType: "bulk_scan_link", resourceId: p.linkId, details: { fileId: won.fileId, target: won.target, targetId: won.targetId, requestedBy: won.requestedBy } });
    });
  });

  queue.subscribe<unknown>(COMMANDS.bulkLinkReject, async (msg) => {
    const p = parse(linkReasonPayload, msg.payload);
    const reason = scrubReasonText(p.reason);   // free text: Aadhaar / phone / PAN / email never reach the DB, the outbox or the audit trail
    const c = ctxOf(msg);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.advisoryXactLock(tx, "bulk_scan_link:" + p.linkId);
      const won = await rrepo.moveLink(tx, { tenantId: msg.tenantId, linkId: p.linkId, from: ["awaiting_approval", "flagged_mismatch"], to: "rejected", reason });
      if (!won) {
        const cur = await rrepo.getLinkTx(tx, msg.tenantId, p.linkId);
        if (!cur) return reject("LINK_NOT_FOUND");
        return reject("NOT_PENDING", cur.state);
      }
      const file = await getFileTx(tx, msg.tenantId, won.fileId);
      if (file && file.state === "ready_to_file") await returnFileToReview(tx, c, file, { reasonCode: "REJECTED_BY_APPROVER", actorId: msg.actorId, now: new Date() });
      await emitAudit(tx, c, { action: "link_rejected", resourceType: "bulk_scan_link", resourceId: p.linkId, details: { fileId: won.fileId, target: won.target, targetId: won.targetId, reason } });
    });
  });

  queue.subscribe<unknown>(COMMANDS.bulkLinkUnlink, async (msg) => {
    const p = parse(unlinkPayload, msg.payload);
    const reason = scrubReasonText(p.reason);   // free text: Aadhaar / phone / PAN / email never reach the DB, the outbox or the audit trail
    const c = ctxOf(msg);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.advisoryXactLock(tx, "bulk_scan_link:" + p.linkId);
      const won = await rrepo.moveLink(tx, { tenantId: msg.tenantId, linkId: p.linkId, from: ["linked"], to: "unlink_requested", reason });
      if (!won) {
        const cur = await rrepo.getLinkTx(tx, msg.tenantId, p.linkId);
        if (!cur) return reject("LINK_NOT_FOUND");
        return reject("NOT_LINKED", cur.state);
      }
      await publishUnlinkRequest(tx, c, { link: won, documentId: won.documentId ?? documentIdFor(won.fileId), reason, requestedBy: msg.actorId });
      await emitEvent(tx, c, EVENTS.bulkLinkUnlinked, { linkId: p.linkId, phase: "requested" });
      await emitAudit(tx, c, { action: "unlink_requested", resourceType: "bulk_scan_link", resourceId: p.linkId, details: { fileId: won.fileId, target: won.target, targetId: won.targetId, reason } });
    });
  });
}
