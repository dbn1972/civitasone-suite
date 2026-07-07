/**
 * ecourts/sync-consumer.ts — Cause-list sync polling consumer.
 *
 * Polls e-Courts for tracked matters on a configurable interval.
 * For each matter with a CNR number:
 *   1. Calls lookupCnr(cnr) to get latest hearing dates and orders
 *   2. Updates hearing schedule records with next hearing date and purpose
 *   3. Downloads court order PDFs (max 50MB) → stores via @civitasone/storage
 *   4. On failure: 3 retries with exponential backoff (1s, 2s, 4s), then skip
 *
 * Env vars:
 *   ECOURTS_SYNC_INTERVAL_MS — polling interval (default: 3600000 = 60 min)
 *     Minimum: 300000 (5 min), Maximum: 86400000 (24 hours)
 *   ECOURTS_ENABLED — adapter must be enabled for sync to run (fail-closed)
 *
 * Requirements: 10.2, 10.3, 10.7
 */

import { pino } from "pino";
import { eq, and, sql } from "drizzle-orm";
import { putObject } from "@civitasone/storage";
import { db } from "../../shared/db.js";
import { legalCases } from "../cases/schema.js";
import { legalHearings } from "../hearings/schema.js";
import { causeListSyncs } from "./sync-schema.js";
import { lookupCnr, isEnabled, type CnrLookupResult, type CourtOrder } from "./adapter.js";

const log = pino({ name: "ecourts.sync-consumer" });

// ── Configuration ─────────────────────────────────────────────────

const MIN_INTERVAL_MS = 5 * 60 * 1000;       // 5 minutes
const MAX_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;  // 60 minutes

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000; // 1s, 2s, 4s

const MAX_ORDER_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

const SYSTEM_ACTOR = "00000000-0000-4000-8000-000000000000";

/**
 * Resolve the polling interval from environment, clamped between min and max.
 */
export function resolveInterval(): number {
  const raw = process.env.ECOURTS_SYNC_INTERVAL_MS;
  if (!raw) return DEFAULT_INTERVAL_MS;
  const parsed = Number(raw);
  if (Number.isNaN(parsed) || parsed <= 0) return DEFAULT_INTERVAL_MS;
  return Math.max(MIN_INTERVAL_MS, Math.min(MAX_INTERVAL_MS, parsed));
}

// ── Retry helper ──────────────────────────────────────────────────

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute an async function with exponential backoff retries.
 * Backoff schedule: 1s, 2s, 4s.
 * Returns result on success, throws after exhausting retries.
 */
export async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        const delay = BASE_BACKOFF_MS * Math.pow(2, attempt);
        log.warn({ attempt: attempt + 1, delay, label, err: String(err) }, "sync: retrying");
        await sleep(delay);
      }
    }
  }
  throw lastErr;
}

// ── PDF Download ──────────────────────────────────────────────────

/**
 * Download a court order PDF from the given URL and store it via @civitasone/storage.
 * Enforces max 50MB file size.
 *
 * @returns The S3 object key where the file was stored, or null if download fails.
 */
export async function downloadAndStoreOrder(
  order: CourtOrder,
  caseId: string,
  tenantId: string,
): Promise<string | null> {
  if (!order.downloadUrl) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000); // 30s download timeout
    let response: Response;
    try {
      response = await fetch(order.downloadUrl, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      log.warn(
        { caseId, orderDate: order.date, status: response.status },
        "sync: order download returned non-OK status",
      );
      return null;
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_ORDER_FILE_SIZE) {
      log.warn(
        { caseId, orderDate: order.date, size: contentLength },
        "sync: order PDF exceeds 50MB limit, skipping",
      );
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_ORDER_FILE_SIZE) {
      log.warn(
        { caseId, orderDate: order.date, size: buffer.byteLength },
        "sync: order PDF exceeds 50MB limit after download, skipping",
      );
      return null;
    }

    const dateSlug = order.date.replace(/[^0-9]/g, "");
    const fileKey = `legal/${tenantId}/${caseId}/orders/${dateSlug}.pdf`;

    await putObject(fileKey, buffer, "application/pdf");

    log.info(
      { caseId, fileKey, sizeBytes: buffer.byteLength },
      "sync: stored court order PDF",
    );

    return fileKey;
  } catch (err) {
    log.error({ caseId, orderDate: order.date, err: String(err) }, "sync: order download failed");
    return null;
  }
}

// ── Core sync logic for one matter ───────────────────────────────

export interface SyncMatterResult {
  caseId: string;
  cnrNumber: string;
  success: boolean;
  nextHearingDate?: string;
  nextHearingPurpose?: string;
  ordersDownloaded: number;
  error?: string;
}

/**
 * Sync a single matter's data from e-Courts: lookup CNR, update hearing dates,
 * download any court orders.
 */
export async function syncMatter(
  caseId: string,
  cnrNumber: string,
  tenantId: string,
): Promise<SyncMatterResult> {
  // Lookup CNR from e-Courts
  const result: CnrLookupResult = await lookupCnr(cnrNumber);

  // Determine next hearing date (latest future date or last entry)
  let nextHearingDate: string | undefined;
  let nextHearingPurpose: string | undefined;

  if (result.hearingDates.length > 0) {
    const today = new Date().toISOString().slice(0, 10);
    // Find the earliest future hearing
    const futureHearings = result.hearingDates
      .filter((h) => h.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date));

    if (futureHearings.length > 0) {
      nextHearingDate = futureHearings[0].date;
      nextHearingPurpose = futureHearings[0].purpose;
    } else {
      // No future hearings — use the most recent one
      const sorted = [...result.hearingDates].sort((a, b) => b.date.localeCompare(a.date));
      nextHearingDate = sorted[0].date;
      nextHearingPurpose = sorted[0].purpose;
    }
  }

  // Update the case's nextDate
  if (nextHearingDate) {
    await db
      .update(legalCases)
      .set({
        nextDate: nextHearingDate,
        updatedAt: new Date(),
        updatedBy: SYSTEM_ACTOR,
      })
      .where(eq(legalCases.id, caseId));
  }

  // Upsert hearing records from e-Courts data
  if (result.hearingDates.length > 0 && nextHearingDate) {
    // Check if a hearing for this date already exists
    const existing = await db
      .select()
      .from(legalHearings)
      .where(and(
        eq(legalHearings.caseId, caseId),
        eq(legalHearings.hearingDate, nextHearingDate),
      ))
      .limit(1);

    if (existing.length === 0) {
      // Insert a new scheduled hearing
      await db.insert(legalHearings).values({
        tenantId,
        caseId,
        hearingDate: nextHearingDate,
        court: result.courtName || "e-Courts",
        purpose: nextHearingPurpose ?? null,
        status: "scheduled",
        createdBy: SYSTEM_ACTOR,
        updatedBy: SYSTEM_ACTOR,
      });
    } else {
      // Update purpose if changed
      if (nextHearingPurpose && existing[0].purpose !== nextHearingPurpose) {
        await db
          .update(legalHearings)
          .set({
            purpose: nextHearingPurpose,
            updatedAt: new Date(),
            updatedBy: SYSTEM_ACTOR,
          })
          .where(eq(legalHearings.id, existing[0].id));
      }
    }
  }

  // Download court orders as PDFs
  let ordersDownloaded = 0;
  for (const order of result.orders) {
    if (order.downloadUrl) {
      const fileKey = await downloadAndStoreOrder(order, caseId, tenantId);
      if (fileKey) {
        ordersDownloaded++;
      }
    }
  }

  return {
    caseId,
    cnrNumber,
    success: true,
    nextHearingDate,
    nextHearingPurpose,
    ordersDownloaded,
  };
}

// ── Poll tick ─────────────────────────────────────────────────────

/**
 * Single poll tick: fetch all tracked matters and sync each one.
 * Exported for testing.
 */
export async function tick(): Promise<{ synced: number; failed: number }> {
  // Fail-closed: skip entirely if adapter disabled
  if (!isEnabled()) {
    log.info("sync: e-Courts adapter disabled, skipping sync");
    return { synced: 0, failed: 0 };
  }

  // Fetch all matters with CNR numbers from cause_list_syncs
  const trackedMatters = await db
    .select()
    .from(causeListSyncs)
    .limit(500); // cap per tick

  if (trackedMatters.length === 0) {
    log.debug("sync: no tracked matters found");
    return { synced: 0, failed: 0 };
  }

  let synced = 0;
  let failed = 0;

  for (const matter of trackedMatters) {
    try {
      const result = await withRetry(
        () => syncMatter(matter.caseId, matter.cnrNumber, matter.tenantId),
        `sync:${matter.cnrNumber}`,
      );

      // Update sync tracking record
      await db
        .update(causeListSyncs)
        .set({
          lastSyncAt: new Date(),
          lastSyncStatus: "success",
          lastError: null,
          nextHearingDate: result.nextHearingDate ?? null,
          nextHearingPurpose: result.nextHearingPurpose ?? null,
          ordersDownloaded: sql`${causeListSyncs.ordersDownloaded} + ${result.ordersDownloaded}`,
          updatedAt: new Date(),
          updatedBy: SYSTEM_ACTOR,
          version: sql`${causeListSyncs.version} + 1`,
        })
        .where(eq(causeListSyncs.id, matter.id));

      synced++;
      log.info(
        { caseId: matter.caseId, cnr: matter.cnrNumber, nextHearing: result.nextHearingDate },
        "sync: matter synced successfully",
      );
    } catch (err) {
      // After 3 retries exhausted — log failure, skip, continue to next matter
      failed++;
      const errorMsg = err instanceof Error ? err.message : String(err);

      await db
        .update(causeListSyncs)
        .set({
          lastSyncAt: new Date(),
          lastSyncStatus: "failed",
          lastError: errorMsg.slice(0, 4000),
          updatedAt: new Date(),
          updatedBy: SYSTEM_ACTOR,
          version: sql`${causeListSyncs.version} + 1`,
        })
        .where(eq(causeListSyncs.id, matter.id));

      log.error(
        { caseId: matter.caseId, cnr: matter.cnrNumber, error: errorMsg },
        "sync: matter sync failed after retries",
      );
    }
  }

  log.info({ synced, failed, total: trackedMatters.length }, "sync: poll tick complete");
  return { synced, failed };
}

// ── Start/Stop ────────────────────────────────────────────────────

/**
 * Start the cause-list sync consumer with configurable polling interval.
 *
 * @returns The interval handle, or null if adapter is disabled.
 */
export function startCauseListSync(): ReturnType<typeof setInterval> | null {
  if (!isEnabled()) {
    log.info("CauseListSync: e-Courts adapter disabled, not starting sync");
    return null;
  }

  const intervalMs = resolveInterval();

  const timer = setInterval(() => void tick().catch((e) => {
    log.error({ err: e }, "CauseListSync: unhandled tick error");
  }), intervalMs);
  timer.unref();

  log.info({ intervalMs }, "CauseListSync: started");
  return timer;
}
