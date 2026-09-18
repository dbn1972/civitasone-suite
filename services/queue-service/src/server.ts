/**
 * queue-service HTTP entrypoint — health + bus observability.
 * Domain services still embed the bus via @civitasone/queue; this service does not proxy publishes.
 */
import { initErrorReporting, registerGracefulShutdown, signalReady } from "@civitasone/observability";
import { buildApp } from "./app.js";

const port = Number(process.env.PORT ?? 3030);
// OPS-1 (09-T1): wire error reporting (Sentry if SENTRY_DSN set, else log-only).
await initErrorReporting("queue-service");
const app = await buildApp();
await app.listen({ port, host: process.env.BIND_HOST ?? "127.0.0.1" });
app.log.info(`queue-service listening on :${port} (driver=${process.env.QUEUE_DRIVER ?? "memory"})`);

// PERF-015 tranche 5: tell PM2 (wait_ready in ecosystem.config.js) this
// process can now actually take traffic — not just that the process started.
signalReady();

registerGracefulShutdown({
  cleanup: async () => {
    // Also runs app.ts's onClose hook, which stops the bus (ends SQS
    // long-polls / closes the RabbitMQ channel / clears MemoryQueue timers).
    await app.close();
  },
  logger: app.log,
  server: app.server,
});
