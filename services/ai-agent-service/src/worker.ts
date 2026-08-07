/**
 * ai-agent-service consumer / outbox relay entrypoint.
 */
import { pino } from "pino";
import { startRelay } from "./shared/outbox.js";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { runWithTenant } from "@civitasone/db";
import { SERVICE } from "./topics.js";
import { registerAgentConsumers } from "./modules/agents/consumer.js";
import { registerAuthoringConsumers } from "./modules/authoring/consumer.js";
import { registerChatConsumers } from "./modules/chat/consumer.js";
import { registerCopilotConsumers } from "./modules/copilot/consumer.js";
import { registerGuardrailConsumers } from "./modules/guardrails/consumer.js";
import { registerProtocolConsumers } from "./modules/protocols/consumer.js";
import { registerToolConsumers } from "./modules/tools/consumer.js";
import { registerGovernanceConsumers } from "./modules/governance/consumer.js";

const log = pino({ name: "ai-agent-worker" });

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

registerAgentConsumers(queue);
registerAuthoringConsumers(queue);
registerChatConsumers(queue);
registerCopilotConsumers(queue);
registerGuardrailConsumers(queue);
registerProtocolConsumers(queue);
registerToolConsumers(queue);
registerGovernanceConsumers(queue);

await queue.start();
const relay = startRelay(db, queue, 1000, SERVICE);

log.info("ai-agent-service worker: consumers + outbox relay running");

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
