/**
 * queue-service HTTP entrypoint — health + bus observability.
 * Domain services still embed the bus via @civitasone/queue; this service does not proxy publishes.
 */
import { initErrorReporting } from "@civitasone/observability";
import { buildApp } from "./app.js";

const port = Number(process.env.PORT ?? 3030);
// OPS-1 (09-T1): wire error reporting (Sentry if SENTRY_DSN set, else log-only).
await initErrorReporting("queue-service");
const app = await buildApp();
await app.listen({ port, host: process.env.BIND_HOST ?? "127.0.0.1" });
app.log.info(`queue-service listening on :${port} (driver=${process.env.QUEUE_DRIVER ?? "memory"})`);
