/**
 * Lease + heartbeat for pipeline steps.
 *
 * A file in a leased state (scanning / ocr_running) carries `lease_expires_at` (set by the dispatcher claim) and
 * `lease_owner` (set when a worker step actually starts). The step:
 *   1. acquireLease: conditional UPDATE ... SET lease_owner = $me WHERE state is leased AND lease_owner IS NULL
 *      (0 rows => another worker is already running this file => the step is dropped);
 *   2. heartbeat every leaseMs/3: conditional UPDATE ... SET lease_expires_at = now + leaseMs
 *      WHERE id AND tenant_id AND lease_owner = $me AND state is leased, under the tenant GUC;
 *   3. if the heartbeat updates 0 rows (re-queued / swept / cancelled) or cannot reach the DB for a full lease
 *      period, the handle aborts its AbortSignal (cancels the OCR call) and reports lost() = true;
 *   4. every state transition passes `leaseOwner` (repo.transition adds it to the WHERE), so a worker that lost
 *      its lease can no longer move the file or write results.
 * The sweeper only reclaims leases whose lease_expires_at has truly passed (repo.transition `leaseExpiredBy`).
 */
import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { pino } from "pino";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { batchFiles } from "./schema.js";
import { LEASED_STATES } from "./state.js";
import { getPorts } from "./ports.js";

const log = pino({ name: "bulk-scan-lease", level: process.env.LOG_LEVEL ?? "info" });

let leaseOverrideMs: number | null = null;
let heartbeatEnabled = true;

/** Lease duration. Default 20 min (env BULK_SCAN_LEASE_MS); tests may shorten it. */
export function leaseMs(): number { return leaseOverrideMs ?? Number(process.env.BULK_SCAN_LEASE_MS ?? 20 * 60_000); }
export function setLeaseMsForTests(ms: number | null): void { leaseOverrideMs = ms; }
/** Test seam: simulate a worker whose heartbeat has died. */
export function setHeartbeatEnabledForTests(on: boolean): void { heartbeatEnabled = on; }

export interface LeaseHandle {
  readonly owner: string;
  readonly signal: AbortSignal;
  lost(): boolean;
  /** Authoritative DB check that this handle still owns an unexpired lease. */
  stillOwns(): Promise<boolean>;
  stop(): void;
}

const leasedStates = [...LEASED_STATES];

/** Returns null when another worker already holds the file (the step must be dropped). */
export async function startLease(tenantId: string, fileId: string): Promise<LeaseHandle | null> {
  const owner = randomUUID();
  const ms = leaseMs();
  const now = getPorts().now();
  const got = await runWithTenant(tenantId, () => db.transaction((tx) =>
    tx.update(batchFiles).set({ leaseOwner: owner, leaseExpiresAt: new Date(now.getTime() + ms), updatedAt: now })
      .where(and(eq(batchFiles.id, fileId), eq(batchFiles.tenantId, tenantId), inArray(batchFiles.state, leasedStates), isNull(batchFiles.leaseOwner)))
      .returning({ id: batchFiles.id })));
  if (got.length === 0) return null;

  const ctl = new AbortController();
  let lost = false;
  let lastOk = Date.now();
  let busy = false;
  const markLost = (why: string): void => {
    if (lost) return;
    lost = true;
    log.warn({ fileId, tenantId, why }, "bulk-scan: lease lost; aborting step");
    ctl.abort();
  };

  const beat = async (): Promise<void> => {
    if (lost || busy) return;
    busy = true;
    try {
      const t = getPorts().now();
      const rows = await runWithTenant(tenantId, () => db.transaction((tx) =>
        tx.update(batchFiles).set({ leaseExpiresAt: new Date(t.getTime() + ms) })
          .where(and(eq(batchFiles.id, fileId), eq(batchFiles.tenantId, tenantId), eq(batchFiles.leaseOwner, owner), inArray(batchFiles.state, leasedStates)))
          .returning({ id: batchFiles.id })));
      if (rows.length === 0) markLost("heartbeat matched no row");
      else lastOk = Date.now();
    } catch (e) {
      log.warn({ fileId, err: e instanceof Error ? e.message : String(e) }, "bulk-scan: heartbeat failed");
      if (Date.now() - lastOk > ms) markLost("heartbeat unreachable for a full lease period");
    } finally {
      busy = false;
    }
  };

  const timer = heartbeatEnabled ? setInterval(() => { void beat(); }, Math.max(10, Math.floor(ms / 3))) : null;
  timer?.unref();

  return {
    owner,
    signal: ctl.signal,
    lost: () => lost,
    async stillOwns() {
      if (lost) return false;
      const rows = await runWithTenant(tenantId, () => db.transaction((tx) =>
        tx.select({ id: batchFiles.id }).from(batchFiles)
          .where(and(eq(batchFiles.id, fileId), eq(batchFiles.tenantId, tenantId), eq(batchFiles.leaseOwner, owner), inArray(batchFiles.state, leasedStates), gt(batchFiles.leaseExpiresAt, getPorts().now())))
          .limit(1)));
      return rows.length > 0;
    },
    stop() { if (timer) clearInterval(timer); },
  };
}
