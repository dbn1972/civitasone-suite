import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { registerEntityConsumers } from "./modules/entities/consumer.js";
import { registerFieldConsumers } from "./modules/fields/consumer.js";
import { registerRuleConsumers } from "./modules/rules/consumer.js";
import { registerRecordConsumers } from "./modules/records/consumer.js";
import { registerFormConsumers } from "./modules/forms/consumer.js";
import { registerCompositionConsumers } from "./modules/composition/consumer.js";
import { registerLayoutConsumers } from "./modules/layouts/consumer.js";
import { registerNumberingConsumers } from "./modules/numbering/consumer.js";
import { registerFormulaConsumers } from "./modules/formula/consumer.js";

registerEntityConsumers(queue);
registerFieldConsumers(queue);
registerRuleConsumers(queue);
registerRecordConsumers(queue);
registerFormConsumers(queue);
registerCompositionConsumers(queue);
registerLayoutConsumers(queue);
registerNumberingConsumers(queue);
registerFormulaConsumers(queue);
await queue.start();
const relay = startRelay(db, queue);
console.log("metadata-service worker running");

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal}: shutting down`);
  clearInterval(relay);
  await queue.stop();
  await sqlClient.end();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
