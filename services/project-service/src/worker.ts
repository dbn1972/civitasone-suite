import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { registerProjectConsumers }     from "./modules/project/consumer.js";
import { registerSchemeConsumers }      from "./modules/scheme/consumer.js";
import { registerProgressConsumers }    from "./modules/progress/consumer.js";
import { registerUcConsumers }          from "./modules/utilisation/consumer.js";
import { registerGeoConsumers }         from "./modules/geo/consumer.js";
import { startRagScheduler }            from "./modules/project/rag.js";

const log = pino({ name: "project-worker" });

registerProjectConsumers(queue);
registerSchemeConsumers(queue);
registerProgressConsumers(queue);
registerUcConsumers(queue);
registerGeoConsumers(queue);

await queue.start();
const relay = startRelay(db, queue);
const ragScheduler = startRagScheduler();
log.info("project-service worker: consumers + outbox relay + RAG scheduler running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(relay);
  clearInterval(ragScheduler);
  await queue.stop();
  await sqlClient.end();
  log.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT",  () => void shutdown("SIGINT"));
