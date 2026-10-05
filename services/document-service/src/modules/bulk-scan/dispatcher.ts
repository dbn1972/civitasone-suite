/**
 * Dispatcher + lease sweeper (worker process only).
 *
 *  - dispatchOnce(): finds due `queued` / `scan_pending` files across ALL tenants (read-only scanner role,
 *    because bulk_scan.* is FORCE RLS), picks work ROUND-ROBIN across tenants (fairPick) so one tenant's huge
 *    batch cannot starve the others, then claims each pick with a conditional transition inside the
 *    tenant's own GUC. Per-tenant concurrency is enforced exactly: the claim transaction takes a per-tenant
 *    advisory lock and re-counts `ocr_running` before claiming.
 *  - sweepOnce(): files whose lease expired (worker crashed mid-step) are re-queued by a conditional
 *    transition with attempts + 1, or dead-lettered when the retry budget is spent.
 */
import { pino } from "pino";
import { runWithTenant } from "@civitasone/db";
import { SYSTEM_ACTOR_ID } from "@civitasone/outbox";
import { db } from "../../shared/db.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { enqueueStep, LEASE_MS } from "./pipeline.js";
import { emitAudit, emitEvent } from "./emit.js";
import { getPorts } from "./ports.js";
import { sweepPendingUploads } from "./upload-sweep.js";
import type { DueFile } from "./repo.js";

const log = pino({ name: "bulk-scan-dispatcher", level: process.env.LOG_LEVEL ?? "info" });

/**
 * Round-robin pick across tenants. `queues` holds each tenant's due items in priority order; `limit` caps
 * how many that tenant may be given this tick; `slots` is the global budget. Starts at `start` (rotating
 * cursor) so the same tenant is not always served first.
 */
export function fairPick<T>(
  queues: ReadonlyMap<string, readonly T[]>,
  limit: ReadonlyMap<string, number>,
  slots: number,
  start = 0,
): Array<{ tenantId: string; item: T }> {
  const tenants = [...queues.keys()].sort();
  const out: Array<{ tenantId: string; item: T }> = [];
  if (tenants.length === 0 || slots <= 0) return out;
  const taken = new Map<string, number>();
  const idx = new Map<string, number>();
  let progressed = true;
  while (out.length < slots && progressed) {
    progressed = false;
    for (let k = 0; k < tenants.length && out.length < slots; k++) {
      const t = tenants[(start + k) % tenants.length] as string;
      const q = queues.get(t) ?? [];
      const i = idx.get(t) ?? 0;
      if (i >= q.length || (taken.get(t) ?? 0) >= (limit.get(t) ?? 0)) continue;
      out.push({ tenantId: t, item: q[i] as T });
      idx.set(t, i + 1);
      taken.set(t, (taken.get(t) ?? 0) + 1);
      progressed = true;
    }
  }
  return out;
}

/** Cross-tenant, read-only work discovery. Production = scanner (BYPASSRLS) pool; tests may inject a per-tenant fake. */
export interface DiscoveryPort {
  dueTenants(now: Date, limit: number): Promise<string[]>;
  dueFiles(tenantId: string, now: Date, cap: number): Promise<DueFile[]>;
  expiredLeases(now: Date, limit: number): Promise<repo.ExpiredLease[]>;
  /** Optional: abandoned pending_upload rows older than `before` (swept to failed UPLOAD_EXPIRED). */
  stalePendingUploads?(before: Date, limit: number): Promise<Array<{ tenantId: string; fileId: string }>>;
}

export function scannerDiscovery(rdb: Parameters<typeof repo.discoverDueTenants>[0]): DiscoveryPort {
  return {
    dueTenants: (now, limit) => repo.discoverDueTenants(rdb, now, limit),
    dueFiles: (t, now, cap) => repo.dueFilesForTenant(rdb, t, now, cap),
    expiredLeases: (now, limit) => repo.discoverExpiredLeases(rdb, now, limit),
    stalePendingUploads: (before, limit) => repo.discoverStalePendingUploads(rdb, before, limit),
  };
}

export interface DispatcherOptions {
  discovery: DiscoveryPort;
  /** Global per-tick claim budget across tenants (worker-wide OCR parallelism). Default env BULK_SCAN_WORKER_SLOTS or 4. */
  slots?: number;
  /** Max due files read per tenant per tick. */
  perTenantCap?: number;
  maxTenants?: number;
  leaseMs?: number;
}

export interface DispatchResult { ocrClaimed: number; scanClaimed: number; tenants: number }

export function createDispatcher(opts: DispatcherOptions) {
  const slots = opts.slots ?? Number(process.env.BULK_SCAN_WORKER_SLOTS ?? 4);
  const perTenantCap = opts.perTenantCap ?? 50;
  const maxTenants = opts.maxTenants ?? 200;
  const leaseMs = opts.leaseMs ?? LEASE_MS;
  let cursor = 0;

  async function dispatchOnce(): Promise<DispatchResult> {
    const ports = getPorts();
    const now = ports.now();
    const tenants = await opts.discovery.dueTenants(now, maxTenants);
    const ocrQueues = new Map<string, DueFile[]>();
    const scanQueues = new Map<string, DueFile[]>();
    const ocrLimit = new Map<string, number>();
    const scanLimit = new Map<string, number>();

    for (const t of tenants) {
      const due = await opts.discovery.dueFiles(t, now, perTenantCap);
      const eff = await runWithTenant(t, () => repo.resolveEffectiveSettings(t));
      const running = await runWithTenant(t, () => db.transaction((tx) => repo.countInState(tx, t, "ocr_running")));
      const ocr = due.filter((d) => d.state === "queued");
      const scan = due.filter((d) => d.state === "scan_pending");
      if (ocr.length) { ocrQueues.set(t, ocr); ocrLimit.set(t, Math.max(0, eff.settings.concurrency - running)); }
      if (scan.length) { scanQueues.set(t, scan); scanLimit.set(t, 10); }
    }
    cursor = tenants.length > 0 ? (cursor + 1) % tenants.length : 0;

    const ocrPicks = fairPick(ocrQueues, ocrLimit, slots, cursor);
    const scanPicks = fairPick(scanQueues, scanLimit, slots * 2, cursor);

    let ocrClaimed = 0;
    let scanClaimed = 0;
    for (const t of tenants) {
      const mineOcr = ocrPicks.filter((x) => x.tenantId === t).map((x) => x.item);
      const mineScan = scanPicks.filter((x) => x.tenantId === t).map((x) => x.item);
      if (mineOcr.length === 0 && mineScan.length === 0) continue;
      const res = await runWithTenant(t, () => claimForTenant(t, mineOcr, mineScan, now, leaseMs));
      ocrClaimed += res.ocr;
      scanClaimed += res.scan;
    }
    return { ocrClaimed, scanClaimed, tenants: tenants.length };
  }

  return {
    dispatchOnce,
    sweepOnce: async () => {
      const now = getPorts().now();
      const leases = await sweepLeases(opts, now);
      const uploads = await sweepPendingUploads(opts.discovery, now);
      return { ...leases, expiredUploads: uploads.expired };
    },
  };
}

/** Claim picks for ONE tenant inside one tx (advisory lock => exact per-tenant concurrency bound). */
export async function claimForTenant(tenantId: string, ocr: DueFile[], scan: DueFile[], now: Date, leaseMs: number): Promise<{ ocr: number; scan: number }> {
  const env = { tenantId, actorId: SYSTEM_ACTOR_ID, correlationId: "bulk-scan-dispatch" };
  return db.transaction(async (tx) => {
    await repo.advisoryXactLock(tx, "bulk_scan_dispatch:" + tenantId);
    const eff = await repo.currentSettingsTx(tx, tenantId);
    let free = Math.max(0, eff.settings.concurrency - (await repo.countInState(tx, tenantId, "ocr_running")));
    let nOcr = 0;
    for (const f of ocr) {
      if (free <= 0) break;
      const ok = await repo.transition(tx, {
        tenantId, fileId: f.fileId, from: ["queued"], to: "ocr_running",
        patch: { leaseExpiresAt: new Date(now.getTime() + leaseMs), nextAttemptAt: null }, reason: "DISPATCHED", now,
      });
      if (!ok) continue;
      await enqueueStep(tx, env, COMMANDS.bulkStepOcr, f.fileId);
      free--; nOcr++;
    }
    let nScan = 0;
    for (const f of scan) {
      const ok = await repo.transition(tx, {
        tenantId, fileId: f.fileId, from: ["scan_pending"], to: "scanning",
        patch: { leaseExpiresAt: new Date(now.getTime() + leaseMs), nextAttemptAt: null }, reason: "SCAN_RETRY", now,
      });
      if (!ok) continue;
      await enqueueStep(tx, env, COMMANDS.bulkStepScan, f.fileId);
      nScan++;
    }
    return { ocr: nOcr, scan: nScan };
  });
}

/** Re-queue (or dead-letter) files whose worker lease expired. Safe to run from several workers. */
export async function sweepLeases(opts: Pick<DispatcherOptions, "discovery">, now: Date): Promise<{ requeued: number; deadLettered: number }> {
  const expired = await opts.discovery.expiredLeases(now, 200);
  let requeued = 0;
  let deadLettered = 0;
  for (const e of expired) {
    await runWithTenant(e.tenantId, async () => {
      const eff = await repo.resolveEffectiveSettings(e.tenantId);
      const c = { tenantId: e.tenantId, actorId: SYSTEM_ACTOR_ID, correlationId: "bulk-scan-sweeper" };
      await db.transaction(async (tx) => {
        const file = await repo.getFileTx(tx, e.tenantId, e.fileId);
        if (!file || file.state !== e.state || !file.leaseExpiresAt || file.leaseExpiresAt > now) return;
        const attempt = file.attempts + 1;
        if (attempt >= eff.settings.maxAttempts) {
          const ok = await repo.transition(tx, {
            tenantId: e.tenantId, fileId: e.fileId, from: [e.state], to: "failed",
            patch: { failureReason: "MAX_ATTEMPTS", deadLetter: true, incrementAttempts: true, nextAttemptAt: null },
            reason: "MAX_ATTEMPTS", detail: { deadLetter: true, cause: "LEASE_EXPIRED" }, now, leaseExpiredBy: now,
          });
          if (ok) {
            deadLettered++;
            await emitAudit(tx, c, { action: "dead_letter", resourceType: "bulk_scan_file", resourceId: e.fileId, outcome: "failure", severity: "warning", details: { reason: "MAX_ATTEMPTS", cause: "LEASE_EXPIRED", attempts: attempt } });
            await emitEvent(tx, c, EVENTS.bulkFileFailed, { fileId: e.fileId, batchId: file.batchId, reason: "MAX_ATTEMPTS" });
            if (await repo.refreshBatchCompletion(tx, e.tenantId, file.batchId, now)) {
              await emitEvent(tx, c, EVENTS.bulkBatchCompleted, { batchId: file.batchId });
            }
          }
          return;
        }
        const to = e.state === "scanning" ? "scan_pending" : "queued";
        const ok = await repo.transition(tx, {
          tenantId: e.tenantId, fileId: e.fileId, from: [e.state], to,
          patch: { incrementAttempts: true, nextAttemptAt: now, failureReason: "LEASE_EXPIRED" },
          reason: "LEASE_EXPIRED", now, leaseExpiredBy: now,
        });
        if (ok) requeued++;
      });
    });
  }
  if (requeued || deadLettered) log.info({ requeued, deadLettered }, "bulk-scan: lease sweep");
  return { requeued, deadLettered };
}

/** Start the periodic dispatcher/sweeper. Returns the timer (clearInterval on shutdown). Never overlaps itself. */
export function startBulkScanScheduler(opts: DispatcherOptions & { intervalMs?: number }): NodeJS.Timeout {
  const d = createDispatcher(opts);
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void (async () => {
      try {
        await d.sweepOnce();
        await d.dispatchOnce();
      } catch (e) {
        log.error({ err: e instanceof Error ? e.message : String(e) }, "bulk-scan: dispatcher tick failed");
      } finally {
        running = false;
      }
    })();
  }, opts.intervalMs ?? Number(process.env.BULK_SCAN_DISPATCH_INTERVAL_MS ?? 2000));
  timer.unref();
  return timer;
}
