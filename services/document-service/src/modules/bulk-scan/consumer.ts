/**
 * bulk-scan command consumers + pipeline step consumers. The ONLY place (with pipeline.ts / dispatcher.ts)
 * that writes the DB. Each handler: markProcessed -> business write -> `audit.event.record` outbox event,
 * all in ONE db.transaction. External I/O (S3, scanner, OCR) never happens inside a transaction.
 *
 * Permanent business rejections throw NonRetryableError (rolls the tx back, goes to the DLQ with a code);
 * transient failures throw a plain Error (queue retries with backoff).
 */
import { createHash } from "node:crypto";
import { pino } from "pino";
import { NonRetryableError, type Queue, type CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { markProcessed, stableUuid } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import * as repo from "./repo.js";
import { emitAudit, emitEvent, type EventCtx } from "./emit.js";
import { getPorts } from "./ports.js";
import { isTenantKey } from "./keys.js";
import { sniffUpload, type RejectReason } from "./magic.js";
import { runScanStep, runOcrStep, enqueueStep, LEASE_MS } from "./pipeline.js";
import { PERMANENT_FAILURE_REASONS, SKIPPABLE_STATES } from "./state.js";
import { isSensitiveChange, changedKeys } from "./settings.js";
import { classifyChange, classifyProfileChange, needsApprovalDirection, settingsApplyDirectly, auditDiff, type Classification } from "./change-classifier.js";
import { settingsSchema, profileConfigSchema, profileChangeSchema, type BulkScanSettings, type ProfileChange } from "./validators.js";
import type { RegisteredFile } from "./commands.js";
import { errMessage } from "./scrub.js";
import { scrubReasonText } from "@civitasone/scan-link";

const log = pino({ name: "bulk-scan-consumer", level: process.env.LOG_LEVEL ?? "info" });

const ctxOf = (m: CommandEnvelope): EventCtx => ({ tenantId: m.tenantId, actorId: m.actorId, correlationId: m.correlationId });
const reject = (code: string, msg?: string): never => { throw new NonRetryableError(code + (msg ? ": " + msg : "")); };

export function registerBulkScanConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  // ── batches ──────────────────────────────────────────────────
  queue.subscribe<{ batchId: string; name: string; targetFolderId?: string; defaultTags: string[]; defaultDocType?: string; linkTarget?: Record<string, unknown>; profileId?: string }>(
    COMMANDS.bulkBatchCreate, async (msg) => {
      const p = msg.payload;
      const eff = await repo.resolveEffectiveSettings(msg.tenantId, p.profileId ?? null);
      if (p.defaultDocType && !eff.settings.classification.docTypes.some((d) => d.id === p.defaultDocType)) reject("UNKNOWN_DOC_TYPE", p.defaultDocType);
      if (p.linkTarget && !eff.settings.allowedLinkTargets.includes(p.linkTarget.target as never)) reject("LINK_TARGET_NOT_ALLOWED", String(p.linkTarget.target));
      if (p.profileId && !eff.profileId) reject("UNKNOWN_PROFILE", p.profileId);
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.insertBatch(tx, {
          id: p.batchId, tenantId: msg.tenantId, name: p.name, targetFolderId: p.targetFolderId ?? null,
          defaultTags: p.defaultTags, defaultDocType: p.defaultDocType ?? null, linkTarget: p.linkTarget ?? null,
          profileId: p.profileId ?? null, status: "open", createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await emitEvent(tx, ctxOf(msg), EVENTS.bulkBatchCreated, { batchId: p.batchId });
        await emitAudit(tx, ctxOf(msg), { action: "batch_create", resourceType: "bulk_scan_batch", resourceId: p.batchId, details: { name: p.name, profileId: p.profileId ?? null } });
      });
    });

  queue.subscribe<{ batchId: string }>(COMMANDS.bulkBatchCancel, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const c = ctxOf(msg);
      if (!(await repo.cancelBatchRow(tx, msg.tenantId, msg.payload.batchId, msg.actorId))) reject("BATCH_NOT_CANCELLABLE");
      const ids = await repo.listFileIdsByStates(tx, msg.tenantId, msg.payload.batchId,
        ["pending_upload", "uploaded", "scanning", "scan_pending", "queued", "ocr_running", "needs_review", "ready_to_file"]);
      let n = 0;
      for (const id of ids) {
        const f = await repo.getFileTx(tx, msg.tenantId, id);
        if (!f) continue;
        if (await repo.transition(tx, { tenantId: msg.tenantId, fileId: id, from: [f.state as never], to: "cancelled", actorId: msg.actorId, reason: "BATCH_CANCELLED" })) n++;
      }
      await emitEvent(tx, c, EVENTS.bulkBatchCancelled, { batchId: msg.payload.batchId, filesCancelled: n });
      await emitAudit(tx, c, { action: "batch_cancel", resourceType: "bulk_scan_batch", resourceId: msg.payload.batchId, details: { filesCancelled: n } });
    });
  });

  // ── file registration (presigned URL issued) ─────────────────
  queue.subscribe<{ batchId: string; files: RegisteredFile[] }>(COMMANDS.bulkFilesRegister, async (msg) => {
    const { batchId, files } = msg.payload;
    const batch = await repo.getBatch(msg.tenantId, batchId);
    if (!batch) reject("BATCH_NOT_FOUND");
    const eff = await repo.resolveEffectiveSettings(msg.tenantId, batch?.profileId ?? null);
    const lim = eff.settings.limits;
    for (const f of files) if (!isTenantKey(msg.tenantId, f.storageKey)) reject("BAD_STORAGE_KEY");
    const bytes = files.reduce((a, f) => a + f.sizeBytes, 0);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      if (files.some((f) => f.sizeBytes > lim.maxFileBytes)) reject("FILE_TOO_LARGE");
      const ok = await repo.reserveBatchCapacity(tx, { tenantId: msg.tenantId, batchId, n: files.length, bytes, maxFiles: lim.maxFilesPerBatch, maxBytes: lim.maxBatchBytes, actorId: msg.actorId });
      if (!ok) reject("BATCH_LIMIT_OR_CLOSED");
      await repo.insertFiles(tx, files.map((f) => ({
        id: f.id, tenantId: msg.tenantId, batchId, originalName: f.name, mimeType: f.mimeType, declaredSizeBytes: f.sizeBytes,
        storageKey: f.storageKey, state: "pending_upload", tags: batch?.defaultTags ?? [], docType: batch?.defaultDocType ?? null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      })));
      await emitAudit(tx, ctxOf(msg), { action: "files_registered", resourceType: "bulk_scan_batch", resourceId: batchId, details: { count: files.length, bytes } });
    });
  });

  // ── upload complete: HEAD, magic bytes, sha256, duplicate policy, -> scanning ──
  queue.subscribe<{ batchId: string; fileIds: string[] }>(COMMANDS.bulkFilesComplete, async (msg) => {
    const missing: string[] = [];
    for (const fileId of msg.payload.fileIds) {
      const outcome = await completeOne(msg, msg.payload.batchId, fileId);
      if (outcome === "not_registered") missing.push(fileId);
    }
    // register may lag the complete (separate commands): let the queue retry the stragglers.
    if (missing.length > 0) throw new Error("bulk-scan: files not registered yet: " + missing.length);
  });

  // ── operator actions ─────────────────────────────────────────
  queue.subscribe<{ fileId: string; reason?: string }>(COMMANDS.bulkFileRetry, async (msg) => {
    const reasonText = msg.payload.reason ? scrubReasonText(msg.payload.reason) : undefined;   // free text: scrubbed of PII before it is stored / audited
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const f = await repo.getFileTx(tx, msg.tenantId, msg.payload.fileId);
      if (!f) return reject("FILE_NOT_FOUND");
      if (f!.retentionDeletedAt) return reject("NOT_RETRYABLE");                       // objects already purged by retention
      if (f!.state !== "failed" || !f!.failureReason || PERMANENT_FAILURE_REASONS.includes(f!.failureReason)) return reject("NOT_RETRYABLE");
      const scanned = f!.scanStatus === "clean" || f!.scanStatus === "skipped_unavailable";
      const to = scanned ? "queued" : "scan_pending";
      const ok = await repo.transition(tx, {
        tenantId: msg.tenantId, fileId: f!.id, from: ["failed"], to, actorId: msg.actorId, reason: "OPERATOR_RETRY",
        patch: { attempts: 0, deadLetter: false, failureReason: null, failureDetail: null, nextAttemptAt: getPorts().now() },   // the pipeline clock, which dispatch compares against
      });
      if (!ok) return reject("NOT_RETRYABLE");
      await repo.reopenBatchIfCompleted(tx, msg.tenantId, f!.batchId, msg.actorId);
      await emitAudit(tx, ctxOf(msg), { action: "file_retry", resourceType: "bulk_scan_file", resourceId: f!.id, details: { to, ...(reasonText ? { reason: reasonText } : {}) } });
    });
  });

  queue.subscribe<{ fileId: string; reason?: string }>(COMMANDS.bulkFileSkip, async (msg) => {
    const reasonText = msg.payload.reason ? scrubReasonText(msg.payload.reason) : undefined;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const f = await repo.getFileTx(tx, msg.tenantId, msg.payload.fileId);
      if (!f) return reject("FILE_NOT_FOUND");
      const skippableFrom = SKIPPABLE_STATES.filter((s) => s === f!.state);
      if (skippableFrom.length === 0) return reject("NOT_SKIPPABLE");
      const ok = await repo.transition(tx, {
        tenantId: msg.tenantId, fileId: f!.id, from: skippableFrom, to: "skipped",
        actorId: msg.actorId, reason: "OPERATOR_SKIP", detail: reasonText ? { reason: reasonText } : null,
      });
      if (!ok) return reject("NOT_SKIPPABLE");
      await emitAudit(tx, ctxOf(msg), { action: "file_skip", resourceType: "bulk_scan_file", resourceId: f!.id, details: { ...(reasonText ? { reason: reasonText } : {}) } });
      if (await repo.refreshBatchCompletion(tx, msg.tenantId, f!.batchId)) await emitEvent(tx, ctxOf(msg), EVENTS.bulkBatchCompleted, { batchId: f!.batchId });
    });
  });

  // ── settings (maker-checker) ─────────────────────────────────
  queue.subscribe<{ requestId: string; settings: unknown; reason?: string }>(COMMANDS.bulkSettingsPropose, async (msg) => {
    const parsed = settingsSchema.safeParse(msg.payload.settings);
    if (!parsed.success) reject("INVALID_SETTINGS");
    const proposed = parsed.data as BulkScanSettings;
    const reasonText = msg.payload.reason ? scrubReasonText(msg.payload.reason) : undefined;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.advisoryXactLock(tx, "bulk_scan_settings:" + msg.tenantId);          // same lock as approvals: classify against the settled current version
      const cur = await repo.currentSettingsTx(tx, msg.tenantId);
      const cls = classifyChange(cur.settings, proposed);
      if (isSensitiveChange(cur.settings, proposed) && !reasonText) reject("REASON_REQUIRED_FOR_SENSITIVE_CHANGE");
      if (settingsApplyDirectly(cls)) {
        // pure security TIGHTENING: applied immediately (the consumer decides, never the route), audited with before/after
        const version = await repo.applySettingsDirect(tx, { tenantId: msg.tenantId, proposed, actorId: msg.actorId });
        await emitEvent(tx, ctxOf(msg), EVENTS.bulkSettingsChanged, { requestId: msg.payload.requestId, version });
        await emitAudit(tx, ctxOf(msg), {
          action: "settings_tightened", resourceType: "bulk_scan_settings", resourceId: msg.payload.requestId,
          details: { direction: cls.direction, version, ...auditDiff(cls), ...(reasonText ? { reason: reasonText } : {}) },
        });
        return;
      }
      const sensitive = needsApprovalDirection(cls);                                   // any loosening: super_admin second approver
      await repo.insertChangeRequest(tx, {
        id: msg.payload.requestId, tenantId: msg.tenantId, proposed: proposed as unknown as Record<string, unknown>,
        baseVersion: cur.version, status: "pending", maker: msg.actorId, reason: reasonText ?? null, sensitive,
      });
      await emitEvent(tx, ctxOf(msg), EVENTS.bulkSettingsChangeRequested, { requestId: msg.payload.requestId, sensitive });
      await emitAudit(tx, ctxOf(msg), {
        action: "settings_change_requested", resourceType: "bulk_scan_settings", resourceId: msg.payload.requestId,
        severity: sensitive ? "warning" : "info", details: { sensitive, direction: cls.direction, changedKeys: changedKeys(cur.settings, proposed), baseVersion: cur.version },
      });
    });
  });

  queue.subscribe<{ requestId: string; actorRoles?: string[]; reason?: string }>(COMMANDS.bulkSettingsApprove, async (msg) => {
    let staleCode: string | null = null;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const r = await repo.approveChangeRequest(tx, {
        tenantId: msg.tenantId, requestId: msg.payload.requestId, checker: msg.actorId,
        // never a boolean claimed by the payload: re-derived from the roles the route stamped from the verified JWT
        checkerIsSuperAdmin: Array.isArray(msg.payload.actorRoles) && msg.payload.actorRoles.includes("super_admin"), reason: msg.payload.reason ? scrubReasonText(msg.payload.reason) : undefined,
      });
      if (!r.ok) {
        if (r.stale) {
          // the request can never apply: it was marked rejected / STALE (committed with the audit event); the error is raised AFTER commit
          await emitAudit(tx, ctxOf(msg), {
            action: r.stale.kind === "profile" ? "profile_change_stale_rejected" : "settings_change_stale_rejected",
            resourceType: r.stale.kind === "profile" ? "bulk_scan_profile" : "bulk_scan_settings", resourceId: r.stale.profileId ?? r.stale.id, severity: "warning",
            details: { requestId: r.stale.id, maker: r.stale.maker, reason: r.stale.decisionReason, code: r.code },
          });
          staleCode = r.code;
          return;
        }
        return reject(r.code);
      }
      if (r.request.kind === "profile") {
        await emitAudit(tx, ctxOf(msg), {
          action: "profile_change_approved", resourceType: "bulk_scan_profile", resourceId: r.request.profileId ?? r.request.id,
          severity: "warning", details: { requestId: r.request.id, maker: r.request.maker, op: (r.request.profileChange as { op?: string } | null)?.op ?? null },
        });
        return;
      }
      await emitEvent(tx, ctxOf(msg), EVENTS.bulkSettingsChanged, { requestId: r.request.id, version: r.version });
      await emitAudit(tx, ctxOf(msg), {
        action: "settings_change_approved", resourceType: "bulk_scan_settings", resourceId: r.request.id,
        severity: r.request.sensitive ? "warning" : "info",
        details: { maker: r.request.maker, version: r.version, sensitive: r.request.sensitive },
      });
    });
    if (staleCode) reject(staleCode);
  });

  queue.subscribe<{ requestId: string; reason: string }>(COMMANDS.bulkSettingsReject, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const r = await repo.rejectChangeRequest(tx, { tenantId: msg.tenantId, requestId: msg.payload.requestId, checker: msg.actorId, reason: scrubReasonText(msg.payload.reason) });
      if (!r.ok) return reject(r.code);
      await emitAudit(tx, ctxOf(msg), { action: r.request.kind === "profile" ? "profile_change_rejected" : "settings_change_rejected", resourceType: r.request.kind === "profile" ? "bulk_scan_profile" : "bulk_scan_settings", resourceId: r.request.id, details: { maker: r.request.maker } });
    });
  });

  // ── profiles ─────────────────────────────────────────────────
  // Every profile consumer takes the per-tenant settings lock (same as the settings consumers) and RE-CLASSIFIES against the
  // settled tenant settings. A change that turned out to need approval between publish and consume (stale `requiresApproval:false`
  // prediction) is turned into a CHANGE REQUEST, never silently dropped.
  const queueProfileChange = async (
    tx: repo.Writer, msg: CommandEnvelope, a: { requestId: string; profileId: string; change: ProfileChange; reason?: string | undefined; existing: { version: number } | null },
  ): Promise<void> => {
    await repo.insertChangeRequest(tx, {
      id: a.requestId, tenantId: msg.tenantId, proposed: {}, baseVersion: a.existing?.version ?? 0, status: "pending",
      maker: msg.actorId, reason: a.reason ?? null, sensitive: true, kind: "profile", profileId: a.profileId,
      profileChange: a.change as unknown as Record<string, unknown>,
    });
    await emitEvent(tx, ctxOf(msg), EVENTS.bulkSettingsChangeRequested, { requestId: a.requestId, sensitive: true, kind: "profile" });
    await emitAudit(tx, ctxOf(msg), {
      action: "profile_change_requested", resourceType: "bulk_scan_profile", resourceId: a.profileId, severity: "warning",
      details: { requestId: a.requestId, op: a.change.op },
    });
  };
  const lockSettings = (tx: repo.Writer, tenantId: string): Promise<void> => repo.advisoryXactLock(tx, "bulk_scan_settings:" + tenantId);

  queue.subscribe<{ profileId: string; name: string; description?: string; config: unknown }>(COMMANDS.bulkProfileCreate, async (msg) => {
    const cfg = profileConfigSchema.safeParse(msg.payload.config);
    if (!cfg.success) reject("INVALID_PROFILE");
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await lockSettings(tx, msg.tenantId);
      const base = (await repo.currentSettingsTx(tx, msg.tenantId)).settings;
      const cls = classifyProfileChange(base, null, cfg.data as Record<string, unknown>);
      if (await repo.profileNameTaken(tx, msg.tenantId, msg.payload.name)) return reject("PROFILE_NAME_TAKEN");
      if (needsApprovalDirection(cls)) {
        return queueProfileChange(tx, msg, {
          requestId: stableUuid("profile-change:" + msg.messageId), profileId: msg.payload.profileId, existing: null,
          change: { op: "create", name: msg.payload.name, description: msg.payload.description ?? null, config: cfg.data } as unknown as ProfileChange,
        });
      }
      await repo.insertProfile(tx, {
        id: msg.payload.profileId, tenantId: msg.tenantId, name: msg.payload.name, description: msg.payload.description ?? null,
        config: cfg.data as Record<string, unknown>, createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await emitAudit(tx, ctxOf(msg), { action: "profile_create", resourceType: "bulk_scan_profile", resourceId: msg.payload.profileId, details: { name: msg.payload.name, direction: cls.direction, ...auditDiff(cls) } });
    });
  });

  queue.subscribe<{ profileId: string; expectedVersion: number; name?: string; description?: string | null; config?: unknown }>(COMMANDS.bulkProfileUpdate, async (msg) => {
    const cfg = msg.payload.config === undefined ? null : profileConfigSchema.safeParse(msg.payload.config);
    if (cfg && !cfg.success) reject("INVALID_PROFILE");
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await lockSettings(tx, msg.tenantId);
      const existing = await repo.getProfileTx(tx, msg.tenantId, msg.payload.profileId);
      let cls: Classification = { direction: "neutral", fields: [] };
      if (existing && cfg && cfg.success) {
        const base = (await repo.currentSettingsTx(tx, msg.tenantId)).settings;
        cls = classifyProfileChange(base, existing.config, cfg.data as Record<string, unknown>);
        if (needsApprovalDirection(cls)) {
          return queueProfileChange(tx, msg, {
            requestId: stableUuid("profile-change:" + msg.messageId), profileId: msg.payload.profileId, existing,
            change: {
              op: "update", expectedVersion: msg.payload.expectedVersion, config: cfg.data,
              ...(msg.payload.name !== undefined ? { name: msg.payload.name } : {}), ...(msg.payload.description !== undefined ? { description: msg.payload.description } : {}),
            } as unknown as ProfileChange,
          });
        }
      }
      const set: Parameters<typeof repo.updateProfile>[1]["set"] = {};
      if (msg.payload.name !== undefined) set.name = msg.payload.name;
      if (msg.payload.description !== undefined) set.description = msg.payload.description;
      if (cfg && cfg.success) set.config = cfg.data as Record<string, unknown>;
      const ok = await repo.updateProfile(tx, { tenantId: msg.tenantId, id: msg.payload.profileId, expectedVersion: msg.payload.expectedVersion, actorId: msg.actorId, set });
      if (!ok) return reject("PROFILE_VERSION_CONFLICT_OR_MISSING");
      await emitAudit(tx, ctxOf(msg), { action: "profile_update", resourceType: "bulk_scan_profile", resourceId: msg.payload.profileId, details: { fields: Object.keys(set), direction: cls.direction, ...auditDiff(cls) } });
    });
  });

  queue.subscribe<{ profileId: string }>(COMMANDS.bulkProfileDelete, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await lockSettings(tx, msg.tenantId);
      const existing = await repo.getProfileTx(tx, msg.tenantId, msg.payload.profileId);
      if (existing && (await repo.profileReferencedTx(tx, msg.tenantId, msg.payload.profileId))) {
        return queueProfileChange(tx, msg, { requestId: stableUuid("profile-change:" + msg.messageId), profileId: msg.payload.profileId, existing, change: { op: "delete" } });
      }
      if (!(await repo.softDeleteProfile(tx, msg.tenantId, msg.payload.profileId, msg.actorId))) return reject("PROFILE_NOT_FOUND");
      await emitAudit(tx, ctxOf(msg), { action: "profile_delete", resourceType: "bulk_scan_profile", resourceId: msg.payload.profileId });
    });
  });

  // Profile change that needs a second approver: queued as a change request (maker != checker, super_admin approver).
  queue.subscribe<{ requestId: string; profileId: string; reason?: string; change: unknown }>(COMMANDS.bulkProfileChangePropose, async (msg) => {
    const change = profileChangeSchema.safeParse(msg.payload.change);
    if (!change.success) return reject("INVALID_PROFILE");
    const reasonText = msg.payload.reason ? scrubReasonText(msg.payload.reason) : undefined;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await lockSettings(tx, msg.tenantId);
      const ch = change.data;
      const existing = ch.op === "create" ? null : await repo.getProfileTx(tx, msg.tenantId, msg.payload.profileId);
      if (ch.op !== "create" && !existing) return reject("PROFILE_NOT_FOUND");
      if (ch.op === "create" && (await repo.profileNameTaken(tx, msg.tenantId, ch.name))) return reject("PROFILE_NAME_TAKEN");
      await queueProfileChange(tx, msg, { requestId: msg.payload.requestId, profileId: msg.payload.profileId, change: ch, reason: reasonText, existing });
    });
  });

  // ── pipeline step consumers ──────────────────────────────────
  queue.subscribe<{ fileId: string }>(COMMANDS.bulkStepScan, async (msg) => {
    await runScanStep(msg, msg.payload.fileId);
  });
  queue.subscribe<{ fileId: string }>(COMMANDS.bulkStepOcr, async (msg) => {
    await runOcrStep(msg, msg.payload.fileId);
  });
}

type CompleteOutcome = "done" | "skipped" | "not_registered";

/** Verify one uploaded object and move it pending_upload -> uploaded -> scanning | skipped_duplicate | failed. */
async function completeOne(msg: CommandEnvelope, batchId: string, fileId: string): Promise<CompleteOutcome> {
  const p = getPorts();
  const c = ctxOf(msg);
  const file = await repo.getFile(msg.tenantId, fileId);
  if (!file) return "not_registered";
  if (file.batchId !== batchId) {                                  // the command named a batch this file does not belong to: never act on it
    log.warn({ tenantId: msg.tenantId, fileId, commandBatchId: batchId }, "bulk-scan: complete for a file of another batch ignored");
    return "skipped";
  }
  if (file.state !== "pending_upload") return "skipped";           // redelivery / already handled
  const eff = await repo.resolveEffectiveSettings(msg.tenantId, (await repo.getBatch(msg.tenantId, file.batchId))?.profileId ?? null);
  const s = eff.settings;
  const derivedId = stableUuid(`${msg.messageId}:${fileId}`);

  const fail = async (reasonCode: string, detail?: string, deleteObject = false): Promise<CompleteOutcome> => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, derivedId))) return;
      const ok = await repo.transition(tx, {
        tenantId: msg.tenantId, fileId, from: ["pending_upload"], to: "failed", actorId: msg.actorId, reason: reasonCode,
        patch: { failureReason: reasonCode, failureDetail: detail ?? null }, detail: { reason: reasonCode },
      });
      if (!ok) return;
      await emitAudit(tx, c, { action: "file_rejected", resourceType: "bulk_scan_file", resourceId: fileId, outcome: "denied", details: { reason: reasonCode, batchId: file.batchId } });
      await emitEvent(tx, c, EVENTS.bulkFileFailed, { fileId, batchId: file.batchId, reason: reasonCode });
      if (await repo.refreshBatchCompletion(tx, msg.tenantId, file.batchId)) await emitEvent(tx, c, EVENTS.bulkBatchCompleted, { batchId: file.batchId });
    });
    if (deleteObject) await p.store.del(file.storageKey).catch((e: unknown) => log.warn({ fileId, err: errMessage(e) }, "bulk-scan: delete rejected object failed"));
    return "done";
  };

  const head = await p.store.head(file.storageKey);
  if (!head) return fail("UPLOAD_MISSING");
  if (head.size !== file.declaredSizeBytes) return fail("SIZE_MISMATCH", `declared ${file.declaredSizeBytes}, stored ${head.size}`, true);
  if (head.size > s.limits.maxFileBytes) return fail("FILE_TOO_LARGE", undefined, true);

  const bytes = await p.store.get(file.storageKey);
  const sniff = sniffUpload(bytes, file.mimeType);
  if (!sniff.ok) return fail(sniff.reason as RejectReason, undefined, true);
  const sha = createHash("sha256").update(bytes).digest("hex");

  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, derivedId))) return;
    const up = await repo.transition(tx, {
      tenantId: msg.tenantId, fileId, from: ["pending_upload"], to: "uploaded", actorId: msg.actorId, reason: "UPLOAD_VERIFIED",
      patch: { sizeBytes: bytes.length, sha256: sha, mimeType: sniff.mime },
    });
    if (!up) return;
    await repo.markBatchProcessing(tx, msg.tenantId, file.batchId);

    // Duplicate policy (tenant-wide by content hash). A per-(tenant,hash) advisory lock makes "first one wins"
    // race-free; the partial unique index uq_bulk_scan_files_canonical_hash is the backstop.
    await repo.advisoryXactLock(tx, `bulk_scan_hash:${msg.tenantId}:${sha}`);
    const canonical = await repo.findCanonicalByHash(tx, msg.tenantId, sha, fileId);
    if (s.duplicatePolicy !== "keep" && canonical) {
      await repo.transition(tx, {
        tenantId: msg.tenantId, fileId, from: ["uploaded"], to: "skipped_duplicate", actorId: msg.actorId, reason: "DUPLICATE_" + s.duplicatePolicy.toUpperCase(),
        patch: { duplicateOf: canonical.id, duplicateAction: s.duplicatePolicy },
        detail: { duplicateOf: canonical.id, policy: s.duplicatePolicy },
      });
      await emitAudit(tx, c, { action: "duplicate_" + s.duplicatePolicy, resourceType: "bulk_scan_file", resourceId: fileId, details: { duplicateOf: canonical.id } });
      if (await repo.refreshBatchCompletion(tx, msg.tenantId, file.batchId)) await emitEvent(tx, c, EVENTS.bulkBatchCompleted, { batchId: file.batchId });
      return;
    }
    const patch: repo.FilePatch = { leaseExpiresAt: new Date(p.now().getTime() + LEASE_MS) };
    if (s.duplicatePolicy === "keep") {
      const other = await repo.findAnyByHash(tx, msg.tenantId, sha, fileId);
      if (other) patch.duplicateOf = other.id;
    } else {
      patch.canonicalForHash = true;
    }
    await repo.transition(tx, { tenantId: msg.tenantId, fileId, from: ["uploaded"], to: "scanning", actorId: msg.actorId, reason: "UPLOAD_VERIFIED", patch });
    await enqueueStep(tx, c, COMMANDS.bulkStepScan, fileId);
  });
  return "done";
}
