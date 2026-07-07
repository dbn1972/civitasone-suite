/**
 * Training orchestrator — Cron-driven model training pipeline.
 *
 * Enumerates active tenants → domains → checks data thresholds → trains →
 * evaluates → registers candidate model. Gated behind FEATURE_ML_TRAINING_ENABLED.
 *
 * Validates: Requirements 4.1, 4.2, 4.5, 4.6, 19.1, 23.5
 */
import { pino } from "pino";
import { randomUUID } from "node:crypto";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import { mlTrainingRuns } from "./schema.js";
import type { ModelDomain } from "../models/schema.js";
import { eq, sql } from "drizzle-orm";

const log = pino({ name: "ml-training-orchestrator" });

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TrainingConfig {
  minRecords: Record<ModelDomain, number>;
  maxTrainingDurationMs: number;
  rollingWindowMonths: number;
}

export const DEFAULT_TRAINING_CONFIG: TrainingConfig = {
  minRecords: {
    leads: 100,
    tickets: 200,
    inventory: 30,
    subscriptions: 50,
    tasks: 5,
    transactions: 1000,
  },
  maxTrainingDurationMs: 30 * 60 * 1000, // 30 minutes
  rollingWindowMonths: 24,
};

export const ALL_DOMAINS: ModelDomain[] = [
  "leads",
  "tickets",
  "inventory",
  "subscriptions",
  "tasks",
  "transactions",
];

// ─── In-flight tracking (prevents duplicate training jobs) ───────────────────

const runningJobs = new Set<string>();

function jobKey(tenantId: string, domain: ModelDomain): string {
  return `${tenantId}:${domain}`;
}

// ─── Cron Scheduling ─────────────────────────────────────────────────────────

/**
 * Parse ML_TRAINING_CRON env var. Supports simplified format:
 *   "DAY HH:MM" where DAY = 0(Sun)–6(Sat), e.g., "0 02:00" for Sunday 02:00 UTC.
 * Defaults to Sunday 02:00 UTC.
 */
export function parseCronSchedule(cron?: string): { dayOfWeek: number; hour: number; minute: number } {
  const defaultSchedule = { dayOfWeek: 0, hour: 2, minute: 0 };
  if (!cron || cron.trim() === "") return defaultSchedule;

  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 2) return defaultSchedule;

  const dayPart = parts[0]!;
  const timePart = parts[1]!;

  const dayOfWeek = parseInt(dayPart, 10);
  const timeParts = timePart.split(":");
  if (timeParts.length !== 2) return defaultSchedule;

  const hour = parseInt(timeParts[0]!, 10);
  const minute = parseInt(timeParts[1]!, 10);

  if (isNaN(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) return defaultSchedule;
  if (isNaN(hour) || hour < 0 || hour > 23) return defaultSchedule;
  if (isNaN(minute) || minute < 0 || minute > 59) return defaultSchedule;

  return { dayOfWeek, hour, minute };
}

/**
 * Determines if the cron should fire based on the current time and configured schedule.
 * Checks are performed every minute; this returns true only when current UTC time
 * matches the configured day-of-week and HH:MM.
 */
export function shouldTrigger(now: Date, schedule: { dayOfWeek: number; hour: number; minute: number }): boolean {
  return (
    now.getUTCDay() === schedule.dayOfWeek &&
    now.getUTCHours() === schedule.hour &&
    now.getUTCMinutes() === schedule.minute
  );
}

// ─── Tenant Enumeration ──────────────────────────────────────────────────────

/**
 * Retrieves active tenants that have ML data. In production this would query
 * the tenant service or a local materialized view of active tenants.
 * For now, we query distinct tenant_ids from ml_feature_vectors or ml_training_runs.
 */
export async function getActiveTenants(): Promise<string[]> {
  const result = await db.execute(
    sql`SELECT DISTINCT tenant_id FROM ml.ml_feature_vectors LIMIT 1000`
  );
  return (result as unknown as Array<{ tenant_id: string }>).map((r) => r.tenant_id);
}

// ─── Data Threshold Check ────────────────────────────────────────────────────

/**
 * Checks if a tenant-domain pair has sufficient training data.
 * Returns the record count if above threshold, or 0 if below.
 */
export async function checkDataThreshold(
  tenantId: string,
  domain: ModelDomain,
  config: TrainingConfig = DEFAULT_TRAINING_CONFIG,
): Promise<number> {
  const windowStart = new Date();
  windowStart.setMonth(windowStart.getMonth() - config.rollingWindowMonths);

  const result = await db.execute(
    sql`SELECT COUNT(*)::int AS cnt FROM ml.ml_feature_vectors
        WHERE tenant_id = ${tenantId}
        AND domain = ${domain}
        AND computed_at >= ${windowStart.toISOString()}`
  );
  const rows = result as unknown as Array<{ cnt: number }>;
  const count = rows[0]?.cnt ?? 0;
  const minRequired = config.minRecords[domain];
  return count >= minRequired ? count : 0;
}

// ─── Training Execution ──────────────────────────────────────────────────────

/**
 * Executes training for a single tenant-domain pair.
 * Creates a training run record, invokes the training logic, evaluates,
 * and registers the candidate model if metrics pass.
 *
 * Enforces a timeout of maxTrainingDurationMs (30 min default).
 */
export async function trainTenantDomain(
  tenantId: string,
  domain: ModelDomain,
  recordCount: number,
  config: TrainingConfig = DEFAULT_TRAINING_CONFIG,
): Promise<{ status: "completed" | "failed" | "skipped"; durationMs: number; metrics: Record<string, number> | null }> {
  const key = jobKey(tenantId, domain);
  if (runningJobs.has(key)) {
    log.info({ tenantId, domain }, "training already running for this tenant-domain pair, skipping");
    return { status: "skipped", durationMs: 0, metrics: null };
  }

  runningJobs.add(key);
  const startTime = Date.now();
  const trainingRunId = randomUUID();
  const correlationId = randomUUID();

  try {
    // Insert training run record as "running"
    await db.insert(mlTrainingRuns).values({
      id: trainingRunId,
      tenantId,
      domain,
      status: "running",
      startedAt: new Date(),
      recordCount,
    });

    // Execute training with timeout
    const result = await Promise.race([
      executeTraining(tenantId, domain, recordCount, config),
      createTimeout(config.maxTrainingDurationMs),
    ]);

    const durationMs = Date.now() - startTime;

    if (result === "timeout") {
      // Mark as failed due to timeout
      await db
        .update(mlTrainingRuns)
        .set({
          status: "failed",
          completedAt: new Date(),
          errorMessage: `Training exceeded timeout of ${config.maxTrainingDurationMs}ms`,
        })
        .where(eq(mlTrainingRuns.id, trainingRunId));

      log.error({ tenantId, domain, durationMs }, "training timed out");

      // Emit training completed event (failed)
      await emitTrainingCompletedEvent(tenantId, domain, trainingRunId, null, "failed", recordCount, null, durationMs, correlationId);

      return { status: "failed", durationMs, metrics: null };
    }

    // Training succeeded — update run record
    await db
      .update(mlTrainingRuns)
      .set({
        status: "completed",
        completedAt: new Date(),
        metrics: result.metrics,
        modelId: result.modelId,
      })
      .where(eq(mlTrainingRuns.id, trainingRunId));

    log.info(
      { tenantId, domain, durationMs, recordCount, metrics: result.metrics },
      "training completed successfully"
    );

    // Emit training completed event (success)
    await emitTrainingCompletedEvent(tenantId, domain, trainingRunId, result.modelId, "completed", recordCount, result.metrics, durationMs, correlationId);

    return { status: "completed", durationMs, metrics: result.metrics };
  } catch (err: unknown) {
    const durationMs = Date.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : "Unknown training error";

    await db
      .update(mlTrainingRuns)
      .set({
        status: "failed",
        completedAt: new Date(),
        errorMessage,
      })
      .where(eq(mlTrainingRuns.id, trainingRunId));

    log.error({ tenantId, domain, durationMs, err: errorMessage }, "training failed");

    // Emit training completed event (failed)
    await emitTrainingCompletedEvent(tenantId, domain, trainingRunId, null, "failed", recordCount, null, durationMs, correlationId);

    return { status: "failed", durationMs, metrics: null };
  } finally {
    runningJobs.delete(key);
  }
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Core training logic placeholder. This will be expanded in task 8.2/8.3
 * to extract data, train the model, and evaluate it.
 */
async function executeTraining(
  tenantId: string,
  domain: ModelDomain,
  _recordCount: number,
  _config: TrainingConfig,
): Promise<{ metrics: Record<string, number>; modelId: string | null }> {
  // Placeholder: In tasks 8.2 and 8.3 this will be wired to:
  // 1. Extract training data (24-month rolling window)
  // 2. Train model (logistic regression / exponential smoothing / etc.)
  // 3. Evaluate on holdout set
  // 4. Register candidate in model registry
  // For now return placeholder metrics so the orchestration loop works end-to-end.
  return { metrics: {}, modelId: null };
}

function createTimeout(ms: number): Promise<"timeout"> {
  return new Promise((resolve) => setTimeout(() => resolve("timeout"), ms));
}

async function emitTrainingCompletedEvent(
  tenantId: string,
  domain: string,
  trainingRunId: string,
  modelId: string | null,
  status: "completed" | "failed" | "skipped",
  recordCount: number,
  metrics: Record<string, number> | null,
  durationMs: number,
  correlationId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await enqueue(tx as Parameters<typeof enqueue>[0], {
      topic: EVENTS.trainingCompleted,
      eventType: EVENTS.trainingCompleted,
      tenantId,
      actorId: "00000000-0000-0000-0000-000000000000", // system actor
      correlationId,
      payload: {
        tenantId,
        domain,
        trainingRunId,
        modelId,
        status,
        recordCount,
        metrics,
        durationMs,
        timestamp: new Date().toISOString(),
        correlationId,
      },
    });
  });
}

// ─── Main Orchestration Loop ─────────────────────────────────────────────────

/**
 * Runs the full training loop: enumerate tenants → domains → check thresholds →
 * train → evaluate → register candidate. Continues to next pair on failure.
 */
export async function runTrainingLoop(config: TrainingConfig = DEFAULT_TRAINING_CONFIG): Promise<{
  total: number;
  completed: number;
  failed: number;
  skipped: number;
}> {
  const stats = { total: 0, completed: 0, failed: 0, skipped: 0 };

  log.info("starting training orchestration loop");

  const tenants = await getActiveTenants();
  log.info({ tenantCount: tenants.length }, "enumerated active tenants");

  for (const tenantId of tenants) {
    for (const domain of ALL_DOMAINS) {
      stats.total++;

      // Check if already running
      const key = jobKey(tenantId, domain);
      if (runningJobs.has(key)) {
        log.info({ tenantId, domain }, "training already running, skipping");
        stats.skipped++;
        continue;
      }

      // Check data threshold
      const recordCount = await checkDataThreshold(tenantId, domain, config);
      if (recordCount === 0) {
        log.info({ tenantId, domain }, "insufficient training data, skipping");
        stats.skipped++;
        continue;
      }

      // Train
      const result = await trainTenantDomain(tenantId, domain, recordCount, config);
      switch (result.status) {
        case "completed":
          stats.completed++;
          break;
        case "failed":
          stats.failed++;
          break;
        case "skipped":
          stats.skipped++;
          break;
      }
    }
  }

  log.info(stats, "training orchestration loop complete");
  return stats;
}

// ─── Cron Entrypoint ─────────────────────────────────────────────────────────

/**
 * Starts the training cron job. Checks every 60 seconds whether the configured
 * schedule has been reached; when it matches, runs the full training loop.
 *
 * Gated behind FEATURE_ML_TRAINING_ENABLED env var.
 *
 * @returns The interval timer (for cleanup on shutdown) or null if disabled.
 */
export function startTrainingCron(checkIntervalMs = 60_000): NodeJS.Timeout | null {
  const enabled = process.env.FEATURE_ML_TRAINING_ENABLED;
  if (enabled !== "true") {
    log.info("FEATURE_ML_TRAINING_ENABLED is not 'true', training cron disabled");
    return null;
  }

  const schedule = parseCronSchedule(process.env.ML_TRAINING_CRON);
  log.info(
    { schedule, cron: process.env.ML_TRAINING_CRON ?? "(default)" },
    "training cron configured"
  );

  let lastTriggerDate = "";

  const timer = setInterval(() => {
    const now = new Date();
    // Avoid double-triggering within the same minute
    const dateKey = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}-${now.getUTCHours()}-${now.getUTCMinutes()}`;
    if (dateKey === lastTriggerDate) return;

    if (shouldTrigger(now, schedule)) {
      lastTriggerDate = dateKey;
      log.info("training cron triggered, starting training loop");
      runTrainingLoop().catch((err) => {
        log.error({ err }, "training loop failed unexpectedly");
      });
    }
  }, checkIntervalMs);

  return timer;
}

// ─── Exports for Testing ─────────────────────────────────────────────────────

export { runningJobs as _runningJobs };
