import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { cache } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";

const log = pino({ name: "finance.fixed-asset.consumer" });

export function registerFixedAssetConsumers(queue: Queue): void {
  queue.subscribe("finance.fixed_asset.register_refresh", async (msg) => {
    const p = msg.payload as { tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
    });
    await cache.invalidate(`finance:${p.tenantId}:fixed_asset:*`);
    log.info({ id: msg.messageId }, "Processed fixed_asset.register_refresh");
  });
}
