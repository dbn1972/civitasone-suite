import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import type { ImportFeature } from "./repo.js";

const log = pino({ name: "location-spatial-exchange-consumer" });
const AUDIT = "audit.event.record";

export function registerSpatialExchangeConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.spatialImport, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; dataset: string; format: "geojson" | "kml"; features: ImportFeature[];
    };
    try {
      let shouldWrite = false;
      await db.transaction(async (tx) => {
        shouldWrite = await markProcessed(tx, msg.messageId);
      });
      if (!shouldWrite) return;
      const stored = await repo.importFeatures(p.tenantId, msg.actorId, p.dataset, p.format, p.features);
      await db.transaction(async (tx) => {
        await enqueue(tx, {
          topic: AUDIT, eventType: AUDIT, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            service: "location", action: "spatial_import", resourceType: "spatial_dataset",
            resourceId: p.dataset, outcome: "success", detail: { imported: stored, format: p.format },
          },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "spatialImport failed");
      throw err;
    }
  });
}
