/**
 * ai-agent-service consumer / outbox relay entrypoint.
 */
import { pino } from "pino";
import { startRelay } from "./shared/outbox.js";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { SERVICE } from "./topics.js";
import { registerAgentConsumers } from "./modules/agents/consumer.js";
import { registerAuthoringConsumers } from "./modules/authoring/consumer.js";
import { registerChatConsumers } from "./modules/chat/consumer.js";
import { registerCopilotConsumers } from "./modules/copilot/consumer.js";
import { registerGuardrailConsumers } from "./modules/guardrails/consumer.js";
import { registerProtocolConsumers } from "./modules/protocols/consumer.js";
import { registerToolConsumers } from "./modules/tools/consumer.js";

const log = pino({ name: "ai-agent-worker" });

registerAgentConsumers(queue);
registerAuthoringConsumers(queue);
registerChatConsumers(queue);
registerCopilotConsumers(queue);
registerGuardrailConsumers(queue);
registerProtocolConsumers(queue);
registerToolConsumers(queue);

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
