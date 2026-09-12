/**
 * inspection-service HTTP server entrypoint.
 * Port: 3036 | Gateway prefix: /api/v1/inspection
 *
 * Graceful shutdown: SIGTERM → drain in-flight requests → close DB pool → exit.
 * PERF-015: ported from an ad-hoc process.on("SIGTERM", ...) handler to the
 * shared registerGracefulShutdown()/signalReady() helper (see PERF-003).
 *
 * _Requirements: 1.1, 1.5, 1.9_
 */
import { registerGracefulShutdown, signalReady } from "@civitasone/observability";
import { buildApp } from "./app.js";
import { sqlClient } from "./shared/db.js";

const PORT = Number(process.env.PORT ?? 3037);
const HOST = process.env.BIND_HOST ?? process.env.HOST ?? "0.0.0.0";

const app = await buildApp();

await app.listen({ port: PORT, host: HOST });
app.log.info({ port: PORT, host: HOST }, "inspection-service listening");

// PERF-015: tell PM2 (wait_ready in ecosystem.config.js) this process can now
// actually take traffic — not just that the process started.
signalReady();

registerGracefulShutdown({
  cleanup: async () => {
    await app.close(); // drain in-flight requests
    await sqlClient.end(); // close DB pool
  },
  logger: app.log,
});
