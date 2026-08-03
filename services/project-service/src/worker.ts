import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { startOutboxPurge } from "@civitasone/outbox";
import { registerProjectConsumers }     from "./modules/project/consumer.js";
import { registerSchemeConsumers }      from "./modules/scheme/consumer.js";
import { registerProgressConsumers }    from "./modules/progress/consumer.js";
import { registerUcConsumers }          from "./modules/utilisation/consumer.js";
import { registerGeoConsumers }         from "./modules/geo/consumer.js";
import { startRagScheduler }            from "./modules/project/rag.js";
import { registerDelayForecastConsumers } from "./modules/delay-forecast/consumer.js";
import { registerBoardIntakeConsumers }   from "./modules/board-intake/consumer.js";
import { registerEvidenceConsumers }      from "./modules/evidence/consumer.js";
import { registerSchedulingConsumers }    from "./modules/scheduling/consumer.js";
import { registerF3ProjectConsumers }   from "./modules/project/f3-consumer.js";

const log = pino({ name: "project-worker" });

registerProjectConsumers(queue);
registerSchemeConsumers(queue);
registerProgressConsumers(queue);
registerUcConsumers(queue);
registerGeoConsumers(queue);
registerDelayForecastConsumers(queue);
// Cross-service choreography: board decision → project intake (for-review).
registerBoardIntakeConsumers(queue);
registerEvidenceConsumers(queue);
registerSchedulingConsumers(queue);
registerF3ProjectConsumers(queue);

await queue.start();
const relay = startRelay(db, queue);
// G7: scheduled outbox purge — remove published messages older than 7 days.
const purge = startOutboxPurge(db as unknown as Parameters<typeof startOutboxPurge>[0], {
  intervalMs: 60 * 60_000,
  batchSize: 1000,
  logger: log,
});
const ragScheduler = startRagScheduler();
log.info("project-service worker: consumers + outbox relay + RAG scheduler running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(purge);
  clearInterval(relay);
  clearInterval(ragScheduler);
  await queue.stop();
  await sqlClient.end();
  log.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT",  () => void shutdown("SIGINT"));
