/**
 * recommendation-service HTTP entrypoint.
 * Domain owner: NBA engine, cross-sell matrix, scoring, health scores.
 * Writes via @civitasone/queue; reads via @civitasone/cache; DB civitas_recommendation only (L1).
 *
 * Run the consumer/relay separately: `pnpm worker` (src/worker.ts).
 */
import { registerGracefulShutdown, signalReady } from "@civitasone/observability";
import { buildApp } from "./app.js";
import { sqlClient } from "./shared/db.js";

const port = Number(process.env.PORT ?? 3040);
const app = await buildApp();
await app.listen({ port, host: process.env.BIND_HOST ?? "127.0.0.1" });
app.log.info(`recommendation-service (API) listening on :${port}`);

// PERF-015: tell PM2 (wait_ready in ecosystem.config.js) this process can now
// actually take traffic — not just that the process started.
signalReady();

registerGracefulShutdown({
  cleanup: async () => {
    await app.close();
    await sqlClient.end();
  },
  logger: app.log,
  server: app.server,
});
