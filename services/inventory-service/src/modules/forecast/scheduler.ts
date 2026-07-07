/**
 * Forecast scheduler — daily refresh job gated behind FEATURE_ML_ENABLED.
 *
 * Triggers a batch feature recompute for the inventory domain via ml-service.
 * Designed to run as part of the worker process.
 *
 * Requirements: 8.8
 */
import { pino } from "pino";

const log = pino({ name: "inventory-forecast-scheduler" });

const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? "http://localhost:3032";
const REFRESH_INTERVAL_MS = Number(process.env.FORECAST_REFRESH_INTERVAL_MS ?? String(24 * 60 * 60 * 1000)); // 24h default

/**
 * Starts the daily forecast refresh scheduler.
 * Returns the interval ID so it can be cleared on shutdown.
 */
export function startForecastRefresh(): ReturnType<typeof setInterval> | null {
  if (process.env.FEATURE_ML_ENABLED !== "true") {
    log.info("FEATURE_ML_ENABLED is not true — forecast refresh scheduler disabled");
    return null;
  }

  log.info({ intervalMs: REFRESH_INTERVAL_MS }, "starting forecast refresh scheduler");

  const interval = setInterval(async () => {
    try {
      await triggerBatchRefresh();
    } catch (err) {
      log.error({ err }, "forecast batch refresh failed");
    }
  }, REFRESH_INTERVAL_MS);

  // Run once immediately on start
  void triggerBatchRefresh().catch((err) => {
    log.error({ err }, "initial forecast batch refresh failed");
  });

  return interval;
}

/**
 * Trigger a batch feature recompute for the inventory domain.
 */
async function triggerBatchRefresh(): Promise<void> {
  log.info("triggering daily forecast batch refresh");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch(`${ML_SERVICE_URL}/v1/ml/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: "system",
        domain: "inventory",
        entityId: "batch-refresh",
        features: { batchRefresh: 1 },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      log.warn({ status: res.status }, "ml-service batch refresh returned non-200");
    } else {
      log.info("forecast batch refresh completed successfully");
    }
  } catch (err) {
    clearTimeout(timeout);
    log.warn({ err }, "forecast batch refresh call failed (will retry next interval)");
  }
}
