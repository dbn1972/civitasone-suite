import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { runWithTenant } from "@civitasone/db";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";

import { registerProposalConsumers } from "./modules/proposal/consumer.js";
import { registerApprovalConsumers } from "./modules/approval/consumer.js";
import { registerBoqConsumers } from "./modules/boq/consumer.js";
import { registerTenderConsumers } from "./modules/tender/consumer.js";
import { registerExecutionConsumers } from "./modules/execution/consumer.js";
import { registerBillingConsumers } from "./modules/billing/consumer.js";

const log = pino({ name: "works-worker" });

// Wrap queue.subscribe to set tenant context from message
{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = queue as any;
  const rawSubscribe = q.subscribe.bind(q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  q.subscribe = (topic: string, handler: (msg: any) => Promise<void>) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rawSubscribe(topic, (msg: any) => runWithTenant(msg.tenantId, () => handler(msg)));
}

registerProposalConsumers(queue);
registerApprovalConsumers(queue);
registerBoqConsumers(queue);
registerTenderConsumers(queue);
registerExecutionConsumers(queue);
registerBillingConsumers(queue);

await queue.start();
const relay = startRelay(db, queue);
log.info("works-service worker: consumers + outbox relay running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(relay);
  await queue.stop();
  await sqlClient.end();
  log.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
