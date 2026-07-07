/**
 * Forecast consumer — listens for inventory.receipt.posted and inventory.issue.posted events.
 *
 * When a receipt or issue is posted, the forecast feature vectors for the affected item
 * should be recomputed. This consumer triggers a feature recomputation request to ml-service.
 *
 * Requirements: 8.8
 */
import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { EVENTS } from "../../topics.js";
import { pino } from "pino";

const log = pino({ name: "inventory-forecast-consumer" });

const ML_SERVICE_URL = process.env.ML_SERVICE_URL ?? "http://localhost:3032";

/**
 * Registers consumers for inventory receipt and issue events that trigger
 * demand forecast feature recomputation in ml-service.
 */
export function registerForecastConsumers(queue: Queue): void {
  // Listen for receipt posted events
  queue.subscribe(EVENTS.receiptPosted, async (msg: CommandEnvelope) => {
    if (process.env.FEATURE_ML_ENABLED !== "true") return;

    const payload = msg.payload as { movementId?: string; toStoreId?: string; lines?: number };
    log.info(
      { messageId: msg.messageId, tenantId: msg.tenantId, movementId: payload.movementId },
      "receipt posted — requesting feature recompute for demand forecast",
    );

    await requestFeatureRecompute(msg.tenantId, msg.correlationId);
  });

  // Listen for issue posted events
  queue.subscribe(EVENTS.issuePosted, async (msg: CommandEnvelope) => {
    if (process.env.FEATURE_ML_ENABLED !== "true") return;

    const payload = msg.payload as { movementId?: string; fromStoreId?: string; lines?: number };
    log.info(
      { messageId: msg.messageId, tenantId: msg.tenantId, movementId: payload.movementId },
      "issue posted — requesting feature recompute for demand forecast",
    );

    await requestFeatureRecompute(msg.tenantId, msg.correlationId);
  });
}

/**
 * Sends a feature recomputation request to ml-service for the inventory domain.
 * Best-effort: logs warning on failure but does not throw.
 */
async function requestFeatureRecompute(tenantId: string, correlationId: string): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(`${ML_SERVICE_URL}/v1/ml/predict`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-correlation-id": correlationId,
      },
      body: JSON.stringify({
        tenantId,
        domain: "inventory",
        entityId: "batch-refresh",
        features: {},
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      log.warn({ status: res.status, tenantId }, "ml-service feature recompute returned non-200");
    }
  } catch (err) {
    log.warn({ err, tenantId }, "ml-service feature recompute call failed (non-critical)");
  }
}
