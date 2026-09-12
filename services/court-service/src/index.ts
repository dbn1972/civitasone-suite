/**
 * court-service HTTP entrypoint (listens on :3034).
 * Run the consumer/relay separately: `pnpm worker` (src/worker.ts).
 */
import { registerGracefulShutdown, signalReady } from "@civitasone/observability";
import { buildApp } from "./app.js";
import { sqlClient } from "./shared/db.js";

const port = Number(process.env.PORT ?? 3034);
const app = await buildApp();

await app.listen({ port, host: process.env.BIND_HOST ?? "127.0.0.1" });
app.log.info({ port }, "court-service listening");

// REL-012: tell PM2 (wait_ready in ecosystem.config.js) this process can now
// actually take traffic — not just that the process started.
signalReady();

// Graceful shutdown (steering: Error Handling & Resilience → Shutdown):
// drain in-flight requests, close the DB pool, then exit. The worker process
// (src/worker.ts) stops its consumers on the same signals independently.
registerGracefulShutdown({
  cleanup: async () => {
    await app.close();
    await sqlClient.end();
  },
  logger: app.log,
  server: app.server,
});
