/**
 * visitor-service HTTP entrypoint.
 * Run the consumer/relay separately: `pnpm worker` (src/worker.ts).
 *
 * PERF-015: ported from an ad-hoc process.on("SIGTERM", ...) handler to the
 * shared registerGracefulShutdown()/signalReady() helper (see PERF-003).
 */
import { registerGracefulShutdown, signalReady } from "@civitasone/observability";
import { buildApp } from "./app.js";
import { sqlClient } from "./shared/db.js";

const port = Number(process.env.PORT ?? 3035);
const app = await buildApp();

await app.listen({ port, host: process.env.BIND_HOST ?? "127.0.0.1" });
app.log.info({ port }, "visitor-service listening");

// PERF-015: tell PM2 (wait_ready in ecosystem.config.js) this process can now
// actually take traffic — not just that the process started.
signalReady();

// Graceful shutdown: drain in-flight requests, close the DB pool, then exit.
registerGracefulShutdown({
  cleanup: async () => {
    await app.close();
    await sqlClient.end();
  },
  logger: app.log,
});
