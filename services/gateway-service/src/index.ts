import { initErrorReporting, registerGracefulShutdown, signalReady } from "@civitasone/observability";
import { buildApp } from "./app.js";
import { sqlClient } from "./shared/db.js";

const port = Number(process.env.PORT ?? 8080);
// OPS-1 (09-T1): wire error reporting (Sentry if SENTRY_DSN set, else log-only).
await initErrorReporting("gateway-service");
const app = await buildApp();
await app.listen({ port, host: process.env.HOST ?? "0.0.0.0" });
app.log.info({ port }, "gateway-service listening");

// PERF-003: tell PM2 (wait_ready in ecosystem.config.js) this process can now
// actually take traffic — not just that the process started.
signalReady();

registerGracefulShutdown({
  cleanup: async () => {
    await app.close();
    await sqlClient.end();
  },
  logger: app.log,
});
