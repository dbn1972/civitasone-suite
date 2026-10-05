/**
 * Pipeline step handlers (run in the worker only). Each step is idempotent and crash-resumable:
 *   - the step message is consumed with markProcessed inside the SAME tx as the state transition
 *     (a redelivered message is a no-op);
 *   - the transition is a conditional UPDATE (`state = ANY(from)`), so a loser of a race drops its result;
 *   - object keys are deterministic per file id, so re-running a step overwrites rather than duplicates;
 *   - external I/O (S3, ClamAV, OCR) happens OUTSIDE any DB transaction.
 */
import { pino } from "pino";
import { markProcessed } from "../../shared/outbox.js";
import { db } from "../../shared/db.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { emitAudit, emitEvent, type EventCtx } from "./emit.js";
import { enqueue } from "../../shared/outbox.js";
import { getPorts } from "./ports.js";
import { keys } from "./keys.js";
import { backoffMs } from "./backoff.js";
import { decideAfterOcr } from "./review.js";
import { OcrStepError } from "./ocr-port.js";
import { errMessage } from "./scrub.js";
import { startLease, leaseMs, type LeaseHandle } from "./lease.js";
import type { BatchFileRow } from "./schema.js";
import type { FilePatch } from "./repo.js";

const log = pino({ name: "bulk-scan", level: process.env.LOG_LEVEL ?? "info" });

export interface StepEnvelope { messageId: string; tenantId: string; actorId: string; correlationId: string }

/** Initial claim lease (dispatcher); the step then heartbeats it every lease/3 (lease.ts). */
export const LEASE_MS = Number(process.env.BULK_SCAN_LEASE_MS ?? 20 * 60_000);
export { leaseMs };
export const SCAN_MAX_ATTEMPTS = Number(process.env.BULK_SCAN_SCAN_MAX_ATTEMPTS ?? 12);

function ctxOf(env: StepEnvelope): EventCtx {
  return { tenantId: env.tenantId, actorId: env.actorId, correlationId: env.correlationId };
}

/** Enqueue an internal step command via the outbox, in the caller's transaction. */
export async function enqueueStep(tx: repo.Writer, env: Pick<StepEnvelope, "tenantId" | "actorId" | "correlationId">, topic: string, fileId: string): Promise<void> {
  await enqueue(tx as Parameters<typeof enqueue>[0], {
    topic, eventType: topic, tenantId: env.tenantId, actorId: env.actorId, correlationId: env.correlationId, payload: { fileId },
  });
}

async function afterSettle(tx: repo.Writer, c: EventCtx, file: BatchFileRow, now: Date): Promise<void> {
  const completed = await repo.refreshBatchCompletion(tx, file.tenantId, file.batchId, now);
  if (completed) {
    await emitEvent(tx, c, EVENTS.bulkBatchCompleted, { batchId: file.batchId });
    await emitAudit(tx, c, { action: "batch_completed", resourceType: "bulk_scan_batch", resourceId: file.batchId });
  }
}

// ── scan step ───────────────────────────────────────────────────

export async function runScanStep(env: StepEnvelope, fileId: string): Promise<void> {
  const file = await repo.getFile(env.tenantId, fileId);
  if (!file || file.state !== "scanning") return;                 // someone else already moved it
  const lease = await startLease(env.tenantId, fileId);
  if (!lease) return;                                             // another worker holds this file
  try { await scanStepLeased(env, fileId, file, lease); } finally { lease.stop(); }
}

async function scanStepLeased(env: StepEnvelope, fileId: string, file: BatchFileRow, lease: LeaseHandle): Promise<void> {
  const p = getPorts();
  const batch = await repo.getBatch(env.tenantId, file.batchId);
  const eff = await repo.resolveEffectiveSettings(env.tenantId, batch?.profileId ?? null);
  const failClosed = eff.settings.malwareFailClosed;

  let buf: Buffer | null = null;
  let verdict: "clean" | "infected" | "error";
  try {
    buf = await p.store.get(file.storageKey);
    verdict = await p.scanner.scan(buf, file.originalName);
  } catch (e) {
    log.warn({ fileId, tenantId: env.tenantId, err: errMessage(e) }, "bulk-scan: scan step I/O failed");
    verdict = "error";
  }
  const c = ctxOf(env);
  const now = p.now();
  if (lease.lost() || !(await lease.stillOwns())) return;         // lost the lease while scanning: stop writing

  if (verdict === "infected" && buf) {
    const qKey = keys.quarantine(file.tenantId, file.batchId, file.id);
    await p.store.put(qKey, buf, "application/octet-stream");   // idempotent (deterministic key)
    const moved = await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, env.messageId))) return false;
      const ok = await repo.transition(tx, {
        tenantId: env.tenantId, fileId, from: ["scanning"], leaseOwner: lease.owner, to: "quarantined",
        patch: { scanStatus: "infected", quarantineKey: qKey, failureReason: "MALWARE_DETECTED" },
        reason: "MALWARE_DETECTED", now,
      });
      if (!ok) return false;
      await emitAudit(tx, c, { action: "quarantine", resourceType: "bulk_scan_file", resourceId: fileId, outcome: "denied", severity: "critical", details: { batchId: file.batchId, quarantineKey: qKey } });
      await emitEvent(tx, c, EVENTS.bulkFileQuarantined, { fileId, batchId: file.batchId });
      await afterSettle(tx, c, file, now);
      return true;
    });
    if (moved) {
      // The original is removed only AFTER the quarantine copy + state commit; failure here is non-fatal (idempotent retry by redelivery).
      await p.store.del(file.storageKey).catch((e: unknown) => log.warn({ fileId, err: errMessage(e) }, "bulk-scan: original delete after quarantine failed"));
    }
    return;
  }

  if (verdict === "clean" || (verdict === "error" && !failClosed)) {
    const failOpen = verdict === "error";
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, env.messageId))) return;
      const ok = await repo.transition(tx, {
        tenantId: env.tenantId, fileId, from: ["scanning"], leaseOwner: lease.owner, to: "queued",
        patch: { scanStatus: failOpen ? "skipped_unavailable" : "clean", attempts: 0, nextAttemptAt: null },
        reason: failOpen ? "SCAN_FAIL_OPEN" : "SCAN_CLEAN", now,
      });
      if (ok && failOpen) {
        await emitAudit(tx, c, { action: "scan_fail_open", resourceType: "bulk_scan_file", resourceId: fileId, severity: "warning", details: { batchId: file.batchId, note: "malware scanner unavailable; tenant setting malwareFailClosed=false" } });
      }
    });
    return;
  }

  // verdict === "error" with fail-closed: hold the file, retry with backoff, NEVER proceed unscanned.
  const attempt = file.attempts + 1;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, env.messageId))) return;
    if (attempt >= SCAN_MAX_ATTEMPTS) {
      const ok = await repo.transition(tx, {
        tenantId: env.tenantId, fileId, from: ["scanning"], leaseOwner: lease.owner, to: "failed",
        patch: { scanStatus: "error", failureReason: "SCAN_UNAVAILABLE", deadLetter: true, incrementAttempts: true, nextAttemptAt: null },
        reason: "SCAN_UNAVAILABLE", detail: { deadLetter: true }, now,
      });
      if (ok) {
        await emitAudit(tx, c, { action: "dead_letter", resourceType: "bulk_scan_file", resourceId: fileId, outcome: "failure", severity: "warning", details: { reason: "SCAN_UNAVAILABLE", attempts: attempt } });
        await afterSettle(tx, c, file, now);
      }
      return;
    }
    await repo.transition(tx, {
      tenantId: env.tenantId, fileId, from: ["scanning"], leaseOwner: lease.owner, to: "scan_pending",
      patch: { scanStatus: "error", incrementAttempts: true, nextAttemptAt: new Date(now.getTime() + backoffMs(attempt, { rand: p.random })) },
      reason: "SCAN_UNAVAILABLE", now,
    });
  });
}

// ── OCR step ────────────────────────────────────────────────────

export async function runOcrStep(env: StepEnvelope, fileId: string): Promise<void> {
  const file = await repo.getFile(env.tenantId, fileId);
  if (!file || file.state !== "ocr_running") return;
  const lease = await startLease(env.tenantId, fileId);
  if (!lease) return;                                             // another worker holds this file
  try { await ocrStepLeased(env, fileId, file, lease); } finally { lease.stop(); }
}

async function ocrStepLeased(env: StepEnvelope, fileId: string, file: BatchFileRow, lease: LeaseHandle): Promise<void> {
  const p = getPorts();
  const batch = await repo.getBatch(env.tenantId, file.batchId);
  const eff = await repo.resolveEffectiveSettings(env.tenantId, batch?.profileId ?? null);
  const s = eff.settings;
  const c = ctxOf(env);
  const now = p.now();

  // Operator preset (batch default doc type, else profile): it decides doc_type; the classifier only cross-checks.
  const knownTypes = new Set(s.classification.docTypes.map((d) => d.id));
  const presetCandidate = batch?.defaultDocType ?? eff.profile?.defaultDocType ?? null;
  const presetDocType = presetCandidate && knownTypes.has(presetCandidate) ? presetCandidate : null;

  let out;
  try {
    const bytes = await p.store.get(file.storageKey);
    out = await p.ocr.run({ tenantId: env.tenantId, fileId, bytes, mimeType: file.mimeType ?? "application/octet-stream", settings: s, presetDocType, signal: lease.signal });
  } catch (e) {
    if (lease.lost()) return;                                     // aborted because the lease was lost: write nothing
    const code = e instanceof OcrStepError ? e.code : "OCR_FAILED";
    const retryable = e instanceof OcrStepError ? e.retryable : true;
    const detail = errMessage(e);
    log.warn({ fileId, tenantId: env.tenantId, code, retryable }, "bulk-scan: ocr step failed");
    await failOcrStep(env, file, { code, retryable, detail }, s.maxAttempts, now, lease);
    return;
  }

  // A worker that lost its lease must not write derivatives (the new owner will produce them).
  if (lease.lost() || !(await lease.stillOwns())) return;

  // Derivatives: deterministic keys, written before the DB commit (a crash leaves harmless idempotent objects).
  const textKey = keys.textMasked(file.tenantId, file.batchId, file.id);
  const jsonKey = keys.structuredJson(file.tenantId, file.batchId, file.id);
  const pdfKey = out.searchablePdf ? keys.searchablePdf(file.tenantId, file.batchId, file.id) : null;
  const pageImages = out.pageImages ?? [];
  try {
    await p.store.put(textKey, out.maskedText, "text/plain; charset=utf-8");
    await p.store.put(jsonKey, JSON.stringify(out.structuredJson), "application/json");
    if (pdfKey && out.searchablePdf) await p.store.put(pdfKey, Buffer.from(out.searchablePdf), "application/pdf");
    for (const img of pageImages) await p.store.put(keys.pageImage(file.tenantId, file.batchId, file.id, img.pageNumber), Buffer.from(img.data), img.mimeType);
  } catch (e) {
    await failOcrStep(env, file, { code: "DERIVATIVE_WRITE_FAILED", retryable: true, detail: errMessage(e) }, s.maxAttempts, now, lease);
    return;
  }

  const decision = decideAfterOcr(
    { meanConfidence: out.meanConfidence, classification: out.classification, fields: out.fields, piiFindings: out.piiFindings, degraded: out.degraded ?? [] },
    s,
  );
  const piiTypes = [...new Set(out.piiFindings.map((f) => f.type))];
  const patch: FilePatch = {
    pageCount: out.pageCount,
    ocrMeanConfidence: out.meanConfidence.toFixed(4),
    docType: out.classification.docType,
    classification: out.classification as unknown as Record<string, unknown>,
    extractedFields: out.fields as unknown[],     // masked by the port contract
    piiFlags: piiTypes,
    piiFindings: out.piiFindings as unknown[],      // offsets + masked previews only (port contract)
    degradedPages: (out.degradedPages ?? []) as unknown[],
    pageImageCount: pageImages.length,
    reviewReasons: decision.reasons,
    textMaskedKey: textKey, structuredJsonKey: jsonKey, searchablePdfKey: pdfKey,
    failureReason: null, failureDetail: null, nextAttemptAt: null,
  };

  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, env.messageId))) return;
    const extracted = await repo.transition(tx, {
      tenantId: env.tenantId, fileId, from: ["ocr_running"], leaseOwner: lease.owner, to: "extracted", patch, reason: "OCR_DONE",
      detail: { providers: out.providerIds, pages: out.pageCount }, now,
    });
    if (!extracted) return;                                   // cancelled / swept meanwhile: someone else won
    await repo.transition(tx, {
      tenantId: env.tenantId, fileId, from: ["extracted"], to: decision.target, reason: decision.reasons[0] ?? "AUTO_OK",
      detail: { reasons: decision.reasons }, now,
    });
    await emitEvent(tx, c, EVENTS.bulkFileExtracted, { fileId, batchId: file.batchId, target: decision.target });
    await afterSettle(tx, c, file, now);
  });
}

async function failOcrStep(
  env: StepEnvelope, file: BatchFileRow, f: { code: string; retryable: boolean; detail: string }, maxAttempts: number, now: Date, lease: LeaseHandle,
): Promise<void> {
  const p = getPorts();
  const c = ctxOf(env);
  const attempt = file.attempts + 1;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, env.messageId))) return;
    const exhausted = attempt >= maxAttempts;
    if (!f.retryable || exhausted) {
      const reason = f.retryable ? "MAX_ATTEMPTS" : f.code;
      const ok = await repo.transition(tx, {
        tenantId: env.tenantId, fileId: file.id, from: ["ocr_running"], leaseOwner: lease.owner, to: "failed",
        patch: { failureReason: reason, failureDetail: f.detail, deadLetter: f.retryable, incrementAttempts: true, nextAttemptAt: null },
        reason, detail: { lastError: f.code, attempts: attempt, deadLetter: f.retryable }, now,
      });
      if (!ok) return;
      await emitAudit(tx, c, { action: f.retryable ? "dead_letter" : "ocr_failed", resourceType: "bulk_scan_file", resourceId: file.id, outcome: "failure", details: { reason, lastError: f.code, attempts: attempt } });
      await emitEvent(tx, c, EVENTS.bulkFileFailed, { fileId: file.id, batchId: file.batchId, reason });
      await afterSettle(tx, c, file, now);
      return;
    }
    await repo.transition(tx, {
      tenantId: env.tenantId, fileId: file.id, from: ["ocr_running"], leaseOwner: lease.owner, to: "queued",
      patch: { failureReason: f.code, failureDetail: f.detail, incrementAttempts: true, nextAttemptAt: new Date(now.getTime() + backoffMs(attempt, { rand: p.random })) },
      reason: "OCR_RETRY", detail: { lastError: f.code, attempt }, now,
    });
  });
}
