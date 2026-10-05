/**
 * Retention sweeper (worker process only).
 *
 * For every tenant that holds filed documents: per doc type with a retention period in the tenant settings
 * (`retentionDaysByType`; absent = keep forever) find FILED documents whose `filed_at` is older than the period and
 *   1. delete the original + every derivative (searchable PDF, masked text, final text, structured JSON, page images)
 *      from the object store (idempotent; a failed delete leaves the document for the next sweep),
 *   2. in ONE transaction: stamp the file purged (conditional UPDATE), soft-delete the document through the FilingPort,
 *      append a file_events row, remove it from the search index, ask every target service holding a link to drop it
 *      (unlink request, reason RETENTION_EXPIRED) and write the audit event + domain event.
 * Cross-tenant discovery uses the read-only scanner pool (bulk_scan.* is FORCE RLS); every write runs under the
 * tenant GUC. Idempotent and safe with several workers: the purge stamp is a conditional UPDATE.
 *
 * NON-FILED terminal files (skipped_duplicate, skipped incl. review rejects, failed incl. upload expiry, cancelled,
 * quarantined) hold raw scans too. After `nonFiledRetentionDays` (tenant setting, default 30) the original, every
 * derivative and the quarantine copy are deleted, the row is stamped purged (content + keys cleared, canonical-hash claim
 * released) and an audit event + file_events row is written; file_events are kept. A failed object delete leaves the file
 * unstamped so the next sweep retries it.
 *
 * UNLINK AFTER PURGE: a purged document's links are asked to unlink (RETENTION_EXPIRED). The file is flagged
 * `retention_unlink_pending`; a refused / lost unlink keeps the link in `unlink_requested` (never back to `linked`) and every
 * sweep re-sends the request (idempotent per link id at the target) and audits the retry, until all links are unlinked.
 *
 * packages/data-governance retention helpers are deliberately NOT used: they filter in memory, while the due set here
 * is selected in SQL (indexed, bounded) and there is no legal-hold source in this module to feed `legalHold`.
 */
import { randomUUID } from "node:crypto";
import { pino } from "pino";
import { runWithTenant } from "@civitasone/db";
import { SYSTEM_ACTOR_ID } from "@civitasone/outbox";
import { db } from "../../shared/db.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as rrepo from "./review-repo.js";
import { fileEvents } from "./schema.js";
import { emitAudit, emitEvent, type EventCtx } from "./emit.js";
import { unindexDocument } from "./filing.js";
import { publishUnlinkRequest } from "./link-flow.js";
import { getPorts } from "./ports.js";
import { keys, isTenantKey } from "./keys.js";
import { errMessage } from "./scrub.js";
import { documentIdFor } from "./ids.js";
import type { BatchFileRow } from "./schema.js";

const log = pino({ name: "bulk-scan-retention", level: process.env.LOG_LEVEL ?? "info" });
const DAY_MS = 86_400_000;

/** Cross-tenant discovery. Every method is keyset-paged by tenant id (`after`): the sweeper keeps a cursor per method so no tenant starves. */
export interface RetentionDiscovery {
  tenants(limit: number, after?: string): Promise<string[]>;
  nonFiledTenants?(limit: number, after?: string): Promise<string[]>;
  unlinkPendingTenants?(limit: number, after?: string): Promise<string[]>;
}

export function scannerRetentionDiscovery(rdb: Parameters<typeof rrepo.tenantsWithFiled>[0]): RetentionDiscovery {
  return {
    tenants: (limit, after) => rrepo.tenantsWithFiled(rdb, limit, after),
    nonFiledTenants: (limit, after) => rrepo.tenantsWithNonFiled(rdb, limit, after),
    unlinkPendingTenants: (limit, after) => rrepo.tenantsWithUnlinkPending(rdb, limit, after),
  };
}

type CursorKind = "filed" | "nonFiled" | "unlink";
const cursors = new WeakMap<RetentionDiscovery, Partial<Record<CursorKind, string>>>();

/** One page of tenants for `kind`, resuming after the previous page's last tenant; wraps to the start when a page comes back short / empty. */
async function nextTenants(d: RetentionDiscovery, kind: CursorKind, limit: number): Promise<string[]> {
  const fn = kind === "filed" ? d.tenants.bind(d) : kind === "nonFiled" ? d.nonFiledTenants?.bind(d) : d.unlinkPendingTenants?.bind(d);
  if (!fn) return [];
  const state = cursors.get(d) ?? {};
  cursors.set(d, state);
  let page = await fn(limit, state[kind]);
  if (page.length === 0 && state[kind]) page = await fn(limit, undefined);
  const last = page.length >= limit ? page[page.length - 1] : undefined;
  if (last) state[kind] = last; else delete state[kind];
  return page;
}

export interface SweepOptions {
  discovery: RetentionDiscovery;
  /** Report what WOULD be purged; nothing is deleted or written. */
  dryRun?: boolean;
  /** Max documents purged per tenant per doc type per sweep. */
  batchSize?: number;
  maxTenants?: number;
  /** Re-send an unconfirmed unlink request only when the link has been waiting at least this long (default env BULK_SCAN_UNLINK_RETRY_MS or 15 min). */
  unlinkRetryAfterMs?: number;
}

export interface SweepResult {
  tenants: number; due: number; purged: number; failed: number; dryRun: boolean; candidates: { tenantId: string; fileId: string; docType: string }[];
  /** Non-filed terminal files: due / purged / failed object deletes (retried next sweep). */
  nonFiled: { due: number; purged: number; failed: number };
  /** Unconfirmed unlinks after a purge: re-sent / fully confirmed. */
  unlinks: { retried: number; completed: number };
}

/** Every object key that belongs to a filed file (original + derivatives + page images). */
export function storageKeysOf(f: Pick<BatchFileRow, "id" | "tenantId" | "batchId" | "storageKey" | "textMaskedKey" | "searchablePdfKey" | "structuredJsonKey" | "finalTextKey" | "pageImageCount">): string[] {
  const out = [f.storageKey, f.textMaskedKey, f.searchablePdfKey, f.structuredJsonKey, f.finalTextKey];
  for (let n = 1; n <= f.pageImageCount; n++) out.push(keys.pageImage(f.tenantId, f.batchId, f.id, n));
  return [...new Set(out.filter((k): k is string => !!k && isTenantKey(f.tenantId, k)))];
}

export async function sweepRetention(opts: SweepOptions): Promise<SweepResult> {
  const p = getPorts();
  const now = p.now();
  const res: SweepResult = {
    tenants: 0, due: 0, purged: 0, failed: 0, dryRun: opts.dryRun === true, candidates: [],
    nonFiled: { due: 0, purged: 0, failed: 0 }, unlinks: { retried: 0, completed: 0 },
  };
  const maxTenants = opts.maxTenants ?? 200;
  const tenants = await nextTenants(opts.discovery, "filed", maxTenants);
  for (const tenantId of tenants) {
    await runWithTenant(tenantId, async () => {
      const cfg = (await repo.resolveEffectiveSettings(tenantId)).settings;
      const policies = Object.entries(cfg.retentionDaysByType);
      if (policies.length === 0) return;
      res.tenants++;
      for (const [docType, days] of policies) {
        const cutoff = new Date(now.getTime() - days * DAY_MS);
        const due = await db.transaction((tx) => rrepo.retentionDue(tx, tenantId, docType, cutoff, opts.batchSize ?? 100));
        for (const d of due) {
          res.due++;
          res.candidates.push({ tenantId, fileId: d.id, docType });
          if (opts.dryRun) continue;
          try {
            if (await purgeOne(tenantId, d.id, days, now)) res.purged++;
          } catch (e) {
            res.failed++;
            log.warn({ tenantId, fileId: d.id, err: errMessage(e) }, "bulk-scan: retention purge failed; will retry next sweep");
          }
        }
      }
    });
  }
  await sweepNonFiled(opts, res, now, maxTenants);
  await sweepPendingUnlinks(opts, res, now, maxTenants);
  if (res.purged || res.failed || res.nonFiled.purged || res.nonFiled.failed || res.unlinks.retried) log.info({ purged: res.purged, failed: res.failed, nonFiled: res.nonFiled, unlinks: res.unlinks }, "bulk-scan: retention sweep");
  return res;
}

/** Every object key of a non-filed terminal file: original, derivatives (incl. deterministic ones a crash may have orphaned), page images, quarantine copy. */
export function nonFiledStorageKeysOf(f: Pick<BatchFileRow, "id" | "tenantId" | "batchId" | "storageKey" | "textMaskedKey" | "searchablePdfKey" | "structuredJsonKey" | "finalTextKey" | "pageImageCount" | "quarantineKey">): string[] {
  const out = [
    ...storageKeysOf(f), f.quarantineKey,
    keys.original(f.tenantId, f.batchId, f.id), keys.textMasked(f.tenantId, f.batchId, f.id), keys.structuredJson(f.tenantId, f.batchId, f.id),
    keys.searchablePdf(f.tenantId, f.batchId, f.id), keys.textFinal(f.tenantId, f.batchId, f.id), keys.quarantine(f.tenantId, f.batchId, f.id),
  ];
  return [...new Set(out.filter((k): k is string => !!k && isTenantKey(f.tenantId, k)))];
}

async function sweepNonFiled(opts: SweepOptions, res: SweepResult, now: Date, maxTenants: number): Promise<void> {
  for (const tenantId of await nextTenants(opts.discovery, "nonFiled", maxTenants)) {
    await runWithTenant(tenantId, async () => {
      const days = (await repo.resolveEffectiveSettings(tenantId)).settings.nonFiledRetentionDays;
      const cutoff = new Date(now.getTime() - days * DAY_MS);
      const due = await db.transaction((tx) => rrepo.nonFiledDue(tx, tenantId, cutoff, opts.batchSize ?? 100));
      for (const d of due) {
        res.nonFiled.due++;
        if (opts.dryRun) continue;
        try {
          if (await purgeNonFiled(tenantId, d.id, days, now)) res.nonFiled.purged++;
        } catch (e) {
          res.nonFiled.failed++;
          log.warn({ tenantId, fileId: d.id, err: errMessage(e) }, "bulk-scan: non-filed purge failed (object delete); will retry next sweep");
        }
      }
    });
  }
}

async function purgeNonFiled(tenantId: string, fileId: string, retentionDays: number, now: Date): Promise<boolean> {
  const p = getPorts();
  const file = await repo.getFile(tenantId, fileId);
  if (!file || file.retentionDeletedAt || !(rrepo.NON_FILED_PURGE_STATES as readonly string[]).includes(file.state)) return false;
  const objectKeys = nonFiledStorageKeysOf(file);
  // object store first, outside any transaction; any failure aborts this file (it stays unstamped and is retried next sweep)
  for (const k of objectKeys) await p.store.del(k);
  const c: EventCtx = { tenantId, actorId: SYSTEM_ACTOR_ID, correlationId: "bulk-scan-retention-" + randomUUID().slice(0, 8) };
  return db.transaction(async (tx) => {
    const stamped = await rrepo.markNonFiledPurged(tx, { tenantId, fileId, actorId: SYSTEM_ACTOR_ID, now });
    if (!stamped) return false;                                                   // another worker purged it first
    await tx.insert(fileEvents).values({
      id: randomUUID(), tenantId, fileId, batchId: file.batchId, fromState: stamped.state, toState: stamped.state, actorId: null,
      reason: "RETENTION_DELETED", detail: { retentionDays, nonFiled: true, objects: objectKeys.length },
    });
    await emitAudit(tx, c, {
      action: "non_filed_retention_deleted", resourceType: "bulk_scan_file", resourceId: fileId, severity: "warning",
      details: { batchId: file.batchId, state: stamped.state, retentionDays, objects: objectKeys.length },
    });
    return true;
  });
}

/** Re-send unlink requests that a target has not confirmed (refused / lost) for purged documents; clear the flag when all are unlinked. */
async function sweepPendingUnlinks(opts: SweepOptions, res: SweepResult, now: Date, maxTenants: number): Promise<void> {
  const retryAfter = opts.unlinkRetryAfterMs ?? Number(process.env.BULK_SCAN_UNLINK_RETRY_MS ?? 15 * 60_000);
  for (const tenantId of await nextTenants(opts.discovery, "unlink", maxTenants)) {
    await runWithTenant(tenantId, async () => {
      const files = await db.transaction((tx) => rrepo.unlinkPendingFiles(tx, tenantId, opts.batchSize ?? 100));
      for (const f of files) {
        if (opts.dryRun) continue;
        const c: EventCtx = { tenantId, actorId: SYSTEM_ACTOR_ID, correlationId: "bulk-scan-retention-" + randomUUID().slice(0, 8) };
        await db.transaction(async (tx) => {
          let retried = 0;
          for (const l of await rrepo.linksForFileTx(tx, tenantId, f.id)) {
            if (l.state === "linked") {
              // a link that slipped back to "linked" (or was created after the purge) is unlinked again
              if (!(await rrepo.moveLink(tx, { tenantId, linkId: l.id, from: ["linked"], to: "unlink_requested", reason: "RETENTION_EXPIRED" }))) continue;
            } else if (l.state !== "unlink_requested" || now.getTime() - l.updatedAt.getTime() < retryAfter) {
              continue;
            } else if (!(await rrepo.moveLink(tx, { tenantId, linkId: l.id, from: ["unlink_requested"], to: "unlink_requested" }))) {
              continue;                                                          // answered meanwhile
            }
            await publishUnlinkRequest(tx, c, { link: l, documentId: l.documentId ?? f.filedDocumentId ?? documentIdFor(f.id), reason: "RETENTION_EXPIRED", requestedBy: SYSTEM_ACTOR_ID });
            await emitAudit(tx, c, {
              action: "retention_unlink_retried", resourceType: "bulk_scan_link", resourceId: l.id, severity: "warning",
              details: { fileId: f.id, target: l.target, targetId: l.targetId, lastReason: l.resultReason ?? null },
            });
            retried++;
          }
          res.unlinks.retried += retried;
          if (retried === 0 && (await rrepo.clearUnlinkPendingIfDone(tx, tenantId, f.id))) res.unlinks.completed++;
        });
      }
    });
  }
}

async function purgeOne(tenantId: string, fileId: string, retentionDays: number, now: Date): Promise<boolean> {
  const p = getPorts();
  const file = await repo.getFile(tenantId, fileId);
  if (!file || file.state !== "filed" || file.retentionDeletedAt || !file.filedDocumentId) return false;
  const documentId = file.filedDocumentId;

  // 1. object store (outside any transaction). Any failure aborts this document; the next sweep retries it.
  for (const k of storageKeysOf(file)) await p.store.del(k);

  // 2. database + events in one transaction
  const c: EventCtx = { tenantId, actorId: SYSTEM_ACTOR_ID, correlationId: "bulk-scan-retention-" + randomUUID().slice(0, 8) };
  return db.transaction(async (tx) => {
    const stamped = await rrepo.markRetentionDeleted(tx, { tenantId, fileId, actorId: SYSTEM_ACTOR_ID, now });
    if (!stamped) return false;                                                   // another worker purged it first
    await p.filing.markDeleted(tx, { tenantId, documentId, actorId: SYSTEM_ACTOR_ID });
    await tx.insert(fileEvents).values({
      id: randomUUID(), tenantId, fileId, batchId: file.batchId, fromState: "filed", toState: "filed", actorId: null,
      reason: "RETENTION_DELETED", detail: { documentId, retentionDays, docType: file.docType },
    });
    await unindexDocument(tx, c, file, documentId, SYSTEM_ACTOR_ID);
    for (const l of await rrepo.linksForFileTx(tx, tenantId, fileId)) {
      if (l.state !== "linked") continue;
      const back = await rrepo.moveLink(tx, { tenantId, linkId: l.id, from: ["linked"], to: "unlink_requested", reason: "RETENTION_EXPIRED" });
      if (back) await publishUnlinkRequest(tx, c, { link: back, documentId, reason: "RETENTION_EXPIRED", requestedBy: SYSTEM_ACTOR_ID });
    }
    if ((await rrepo.linksForFileTx(tx, tenantId, fileId)).some((l) => l.state === "unlink_requested")) await rrepo.flagUnlinkPending(tx, tenantId, fileId);
    await emitEvent(tx, c, EVENTS.bulkFileRetentionDeleted, { fileId, batchId: file.batchId, documentId });
    await emitAudit(tx, c, {
      action: "retention_deleted", resourceType: "bulk_scan_file", resourceId: fileId, severity: "warning",
      details: { documentId, docType: file.docType, retentionDays, filedAt: file.filedAt?.toISOString() ?? null, objects: storageKeysOf(file).length },
    });
    return true;
  });
}

/** Periodic sweep. Never overlaps itself; hourly by default (env BULK_SCAN_RETENTION_INTERVAL_MS). */
export function startRetentionScheduler(opts: SweepOptions & { intervalMs?: number }): NodeJS.Timeout {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void sweepRetention(opts)
      .catch((e: unknown) => log.error({ err: errMessage(e) }, "bulk-scan: retention tick failed"))
      .finally(() => { running = false; });
  }, opts.intervalMs ?? Number(process.env.BULK_SCAN_RETENTION_INTERVAL_MS ?? 60 * 60_000));
  timer.unref();
  return timer;
}
