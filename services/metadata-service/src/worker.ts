import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";

const log = pino({ name: "metadata-worker" });
import { registerEntityConsumers } from "./modules/entities/consumer.js";
import { registerFieldConsumers } from "./modules/fields/consumer.js";
import { registerRuleConsumers } from "./modules/rules/consumer.js";
import { registerRecordConsumers } from "./modules/records/consumer.js";
import { registerFormConsumers } from "./modules/forms/consumer.js";
import { registerCompositionConsumers } from "./modules/composition/consumer.js";
import { registerLayoutConsumers } from "./modules/layouts/consumer.js";
import { registerNumberingConsumers } from "./modules/numbering/consumer.js";
import { registerFormulaConsumers } from "./modules/formula/consumer.js";
import { runWithTenant } from "@civitasone/db";

// Wrap queue.subscribe to set tenant context from message — consumers run
// db.transaction() and RLS policies require app.tenant_id GUC to be set.
{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = queue as any;
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  q.subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
}

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
log.info("metadata-service worker running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(relay);
  await queue.stop();
  await sqlClient.end();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
