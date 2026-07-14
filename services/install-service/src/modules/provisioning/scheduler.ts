/**
 * Provisioning_Actuator worker poll-loop scheduler (task 7.7).
 *
 * Unlike `consumer.ts` (which reacts to inbound queue messages), this module is
 * the *initiator*: on a recurring interval it scans `install.silo_provisions`
 * for records that need attention — `requested`, `failed`, or a `provisioning`
 * record whose `updatedAt` is older than `staleMs` (a crashed/interrupted
 * runner, per the design's error-handling table) — and drives each one through
 * the actual database-creation + migration work.
 *
 * Ordering guarantees (Req 3.2, 3.7):
 *   1. Claim: optimistic-locked transition to `provisioning` BEFORE any I/O
 *      (`repo.claimProvisioning`), so two overlapping ticks or worker instances
 *      never race on the same tenant.
 *   2. Actuate: `provisionSiloDatabase` against a `PROVISIONING_RUNNER_DSN`-
 *      sourced connection — never `DATABASE_URL`. If the env var is unset, the
 *      cycle fails fast with a logged error and does nothing (no silent
 *      fallback to any service's own runtime DSN).
 *   3. Finalize: on a *confirmed* `ready` (domain.ts's `migrationsConfirmed`
 *      against the full fleet migration list, not just the actuator's own
 *      status field), persist `ready` + `appliedMigrations` + `readyAt`,
 *      publish the registry-update command `tenant-service` consumes to set
 *      `dbDsnRef` (Req 4.2 — ready-only, never on `failed`/intermediate
 *      states), and emit a completion Audit_Event. On `failed`, persist
 *      `failed` + a *redacted* `error`, log a redacted structured failure
 *      entry, and still emit the completion Audit_Event (Req 3.5, 4.4).
 *
 * This is NOT a queue consumer — like the rest of this module it publishes via
 * the transactional outbox (`enqueue()` inside the same `db.transaction()` as
 * the status write; the outbox relay started in `worker.ts` delivers it after
 * commit), never a direct `queue.publish()`. There is no inbound message to
 * idempotency-check here, so `markProcessed` does not apply — the idempotency
 * guarantee instead comes from the optimistic-locked claim step (1) above.
 * Scheduling idiom mirrors `services/meeting-service/src/workers/
 * tenure-expiry.ts`'s `startTenureExpiryScheduler`.
 *
 * _Requirements: 3.2, 3.5, 3.7, 4.1, 4.2, 4.4, 4.5, 15.2, 15.3_
 */
import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { pino, type Logger } from "pino";
import { createSqlClient } from "@civitasone/db";
import { redactLogPayload } from "@civitasone/observability";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { TENANT_SET_ISOLATION } from "../../topics.js";
import * as repo from "./repo.js";
import type { SiloProvisionRow } from "./schema.js";
import { nextStatus, migrationsConfirmed } from "./domain.js";
import { provisionSiloDatabase, listAllMigrationIds, DEFAULT_ROOT, type ActuatorResult } from "./actuator.js";

const AUDIT_TOPIC = "audit.event.record";
/** Actor id stamped on system-generated events/audit rows — no human triggers a poll cycle. */
export const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

/** Default cadence between poll cycles: 30s. Override via `PROVISIONING_POLL_INTERVAL_MS`. */
export const DEFAULT_POLL_INTERVAL_MS = 30_000;
/** Default staleness threshold for a `provisioning` record: ~10 minutes. Override via `PROVISIONING_STALE_MS`. */
export const DEFAULT_STALE_MS = 10 * 60_000;
/** Default max records claimed per poll cycle. */
export const DEFAULT_BATCH_SIZE = 5;

export interface ProvisioningSchedulerOptions {
  /** Cadence between poll cycles (ms). Defaults to `PROVISIONING_POLL_INTERVAL_MS` env or 30s. */
  intervalMs?: number;
  /** Staleness threshold for reclaiming a stuck `provisioning` record (ms). Defaults to `PROVISIONING_STALE_MS` env or 10 min. */
  staleMs?: number;
  /** Max records claimed per poll cycle. */
  batchSize?: number;
  logger?: Logger;
  /** Privileged runner DSN override (tests). Defaults to `process.env.PROVISIONING_RUNNER_DSN`. */
  runnerDsn?: string;
  /** Migration-root override (tests). Defaults to the actuator's repo-root resolution. */
  reposRoot?: string;
  /** Clock override (tests). */
  now?: () => Date;
}

export interface ProvisioningPollResult {
  /** Records picked up by this cycle (requested/failed/stale-provisioning). */
  scanned: number;
  /** Records that reached a confirmed `ready` transition this cycle. */
  ready: number;
  /** Records that reached `failed` this cycle. */
  failed: number;
  /** Records skipped (lost the optimistic claim race, or the runner DSN was unset). */
  skipped: number;
}

/** Everything a single poll cycle needs, resolved once per cycle (avoids re-reading env per record). */
interface ResolvedOptions {
  log: Logger;
  reposRoot: string;
}

/**
 * Run one poll cycle: scan → claim → actuate → finalize, for up to `batchSize`
 * pollable records. Never throws — per-record failures are caught, logged, and
 * counted as `skipped` so one bad record never blocks the rest of the batch.
 */
export async function runProvisioningPollCycle(
  opts: ProvisioningSchedulerOptions = {},
): Promise<ProvisioningPollResult> {
  const log = opts.logger ?? pino({ name: "install-provisioning-scheduler" });
  const result: ProvisioningPollResult = { scanned: 0, ready: 0, failed: 0, skipped: 0 };

  // Req 3.7: fail fast / skip the cycle with a logged error if the privileged
  // runner DSN is unset — NEVER fall back to any service's own DATABASE_URL.
  const runnerDsn = opts.runnerDsn ?? process.env.PROVISIONING_RUNNER_DSN;
  if (!runnerDsn) {
    log.error(
      redactLogPayload({ correlationId: randomUUID() }),
      "provisioning-scheduler: PROVISIONING_RUNNER_DSN is not set; skipping poll cycle",
    );
    return result;
  }

  const staleMs = opts.staleMs ?? Number(process.env.PROVISIONING_STALE_MS ?? DEFAULT_STALE_MS);
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  const reposRoot = opts.reposRoot ?? DEFAULT_ROOT;
  const now = opts.now ?? (() => new Date());

  const staleBefore = new Date(now().getTime() - staleMs);
  const candidates = await repo.findPollable(staleBefore, batchSize);
  result.scanned = candidates.length;
  if (candidates.length === 0) return result;

  const requiredMigrations = listAllMigrationIds(reposRoot);
  const runnerConn = createSqlClient(runnerDsn, { max: 1 });
  const resolved: ResolvedOptions = { log, reposRoot };
  try {
    for (const record of candidates) {
      try {
        const outcome = await processRecord(record, requiredMigrations, runnerConn, resolved);
        result[outcome] += 1;
      } catch (err) {
        result.skipped += 1;
        log.error(
          redactLogPayload({
            tenantId: record.tenantId,
            correlationId: randomUUID(),
            err: err instanceof Error ? err.stack : String(err),
          }),
          "provisioning-scheduler: unexpected error processing record",
        );
      }
    }
  } finally {
    await runnerConn.end({ timeout: 5 }).catch(() => undefined);
  }
  return result;
}

/**
 * Claim → actuate → finalize a single Silo_Provisioning_Record. Returns which
 * bucket the record landed in this cycle (`ready`/`failed`/`skipped` — the
 * latter meaning another worker tick won the claim race for this record).
 */
async function processRecord(
  record: SiloProvisionRow,
  requiredMigrations: string[],
  runnerConn: postgres.Sql,
  opts: ResolvedOptions,
): Promise<"ready" | "failed" | "skipped"> {
  const correlationId = randomUUID();
  const runnerStartedAt = new Date();

  // 1) Claim: transition to `provisioning` BEFORE any I/O (Req 3.2). Optimistic
  //    lock on `version` — if another tick already claimed this record between
  //    the poll scan and now, this is a no-op and we skip it this cycle.
  const claimed = await db.transaction(async (tx) =>
    repo.claimProvisioning(tx, record.id, record.version, SYSTEM_ACTOR_ID, runnerStartedAt),
  );
  if (!claimed) return "skipped";
  const claimedVersion = record.version + 1;

  // 2) Actuate — the only I/O here, against the injected privileged runner
  //    connection (Req 3.7). Resumable: re-applies only migrations not already
  //    in `appliedMigrations` (Property 5).
  const alreadyApplied = Array.isArray(record.appliedMigrations) ? [...record.appliedMigrations] : [];
  const startedAt = Date.now();
  const actuatorResult = await provisionSiloDatabase(
    record.tenantId,
    record.dbName,
    alreadyApplied,
    runnerConn,
    { reposRoot: opts.reposRoot },
  );
  const durationMs = Date.now() - startedAt;

  // Req 3.8/4.5: the persisted transition is driven ONLY by domain.ts's state
  // machine — never by trusting `actuatorResult.status` directly. `ready` is
  // reachable only via `complete` with a fleet-wide `migrationsConfirmed`
  // check (Property 6), so an actuator-reported "ready" that disagrees with
  // the confirmation check (e.g. a reposRoot drift) still resolves to `failed`
  // here, letting a subsequent poll resume and reapply only the genuinely
  // missing migrations (Property 5).
  const confirmed = actuatorResult.status === "ready"
    ? migrationsConfirmed({ requiredMigrations, appliedMigrations: actuatorResult.appliedMigrations })
    : false;
  const next = actuatorResult.status === "ready"
    ? nextStatus("provisioning", { type: "complete", migrationsConfirmed: confirmed })
    : nextStatus("provisioning", { type: "fail" });

  if (next === "ready") {
    await finalizeReady(record, claimedVersion, actuatorResult, durationMs, correlationId, opts.log);
    return "ready";
  }

  const finalResult: ActuatorResult = actuatorResult.status === "ready"
    ? {
        ...actuatorResult,
        status: "failed",
        failingStep: actuatorResult.failingStep ?? "migrations_confirmed_check",
        error: actuatorResult.error ?? "actuator reported ready but required migrations are not fully confirmed",
      }
    : actuatorResult;
  await finalizeFailed(record, claimedVersion, finalResult, durationMs, correlationId, opts.log);
  return "failed";
}

/**
 * Persist the confirmed `ready` transition, publish the registry-update
 * command `tenant-service` consumes to set `dbDsnRef` (ONLY here — Req 4.2),
 * and emit the completion Audit_Event (Req 3.5).
 *
 * `dbDsnRef` is the tenant's dedicated database name — the same resolvable
 * reference `TENANT_SILO_DSN_TEMPLATE` combines with to build the actual DSN
 * (`docs/architecture/MULTI-TENANCY.md` §"silo tenant" resolver), never a raw
 * connection string or credential.
 */
async function finalizeReady(
  record: SiloProvisionRow,
  claimedVersion: number,
  actuatorResult: ActuatorResult,
  durationMs: number,
  correlationId: string,
  log: Logger,
): Promise<void> {
  await db.transaction(async (tx) => {
    await repo.update(tx, record.id, {
      status: "ready",
      appliedMigrations: actuatorResult.appliedMigrations,
      steps: actuatorResult.steps,
      error: null,
      readyAt: new Date(),
      updatedBy: SYSTEM_ACTOR_ID,
      version: claimedVersion + 1,
    });
    await enqueue(tx, {
      topic: AUDIT_TOPIC,
      eventType: AUDIT_TOPIC,
      tenantId: record.tenantId,
      actorId: SYSTEM_ACTOR_ID,
      correlationId,
      payload: {
        service: "install", action: "silo_provision.ready", resourceType: "silo_provision",
        resourceId: record.id, outcome: "ready", durationMs,
      },
    });
    // Req 4.2: publish ONLY on a confirmed transition into `ready` — never on
    // `failed` or an intermediate status. `tenant-service`'s existing
    // `setIsolation` consumer patches the Tenant_Registry's `dbDsnRef`.
    await enqueue(tx, {
      topic: TENANT_SET_ISOLATION,
      eventType: TENANT_SET_ISOLATION,
      tenantId: record.tenantId,
      actorId: SYSTEM_ACTOR_ID,
      correlationId,
      payload: { id: record.tenantId, tier: "silo", dbDsnRef: record.dbName, kmsKeyRef: null },
    });
  });
  log.info(
    redactLogPayload({ tenantId: record.tenantId, correlationId, durationMs, outcome: "ready" }),
    "provisioning-scheduler: silo provisioning ready",
  );
}

/**
 * Persist the `failed` transition with a *redacted* error (Req 4.4 — the
 * persisted `error` never contains a raw DSN/credential), log a redacted
 * structured failure entry with `tenantId`/`failingStep`/`correlationId`, and
 * still emit the completion Audit_Event (Req 3.5) — registry `dbDsnRef`/
 * `isolationTier` are never touched on failure (Req 4.1's fail-closed rule).
 */
async function finalizeFailed(
  record: SiloProvisionRow,
  claimedVersion: number,
  actuatorResult: ActuatorResult,
  durationMs: number,
  correlationId: string,
  log: Logger,
): Promise<void> {
  const redacted = redactLogPayload({
    tenantId: record.tenantId,
    failingStep: actuatorResult.failingStep ?? null,
    correlationId,
    error: actuatorResult.error ?? "unknown error",
  });
  const redactedError = typeof redacted.error === "string" ? redacted.error : String(actuatorResult.error ?? "unknown error");

  await db.transaction(async (tx) => {
    await repo.update(tx, record.id, {
      status: "failed",
      appliedMigrations: actuatorResult.appliedMigrations,
      steps: actuatorResult.steps,
      error: redactedError,
      updatedBy: SYSTEM_ACTOR_ID,
      version: claimedVersion + 1,
    });
    await enqueue(tx, {
      topic: AUDIT_TOPIC,
      eventType: AUDIT_TOPIC,
      tenantId: record.tenantId,
      actorId: SYSTEM_ACTOR_ID,
      correlationId,
      payload: {
        service: "install", action: "silo_provision.failed", resourceType: "silo_provision",
        resourceId: record.id, outcome: "failed", durationMs,
      },
    });
  });
  log.error(redacted, "provisioning-scheduler: silo provisioning failed");
}

/**
 * Start the recurring provisioning poll loop. Runs `runProvisioningPollCycle`
 * every `intervalMs` (default 30s) and never rethrows — a failing cycle is
 * logged and the loop continues (mirrors `startOutboxPurge`/`startRelay`/
 * `startTenureExpiryScheduler`). Returns the interval handle so `worker.ts` can
 * `clearInterval` it on graceful shutdown.
 */
export function startProvisioningPollLoop(
  opts: ProvisioningSchedulerOptions = {},
): NodeJS.Timeout {
  const log = opts.logger ?? pino({ name: "install-provisioning-scheduler" });
  const intervalMs = opts.intervalMs ?? Number(process.env.PROVISIONING_POLL_INTERVAL_MS ?? DEFAULT_POLL_INTERVAL_MS);
  const tick = (): void => {
    void runProvisioningPollCycle({ ...opts, logger: log }).catch((err) => {
      log.error({ err: err instanceof Error ? err.stack : String(err) }, "provisioning-scheduler: poll cycle failed");
    });
  };
  const handle = setInterval(tick, intervalMs);
  if (typeof handle.unref === "function") handle.unref();
  return handle;
}
