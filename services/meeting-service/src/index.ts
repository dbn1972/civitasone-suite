/**
 * meeting-service HTTP entrypoint (listens on :3033).
 * Run the consumer/relay separately: `pnpm worker` (src/worker.ts).
 */
import { buildApp } from "./app.js";
import { sqlClient } from "./shared/db.js";

const port = Number(process.env.PORT ?? 3033);
const app = await buildApp();

await app.listen({ port, host: process.env.BIND_HOST ?? "127.0.0.1" });
app.log.info({ port }, "meeting-service listening");

// Graceful shutdown (steering: Error Handling & Resilience → Shutdown):
// drain in-flight requests, close the DB pool, then exit. The worker process
// (src/worker.ts) stops its consumers on the same signals independently.
async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "shutting down");
  try {
    await app.close();
    await sqlClient.end();
    app.log.info("shutdown complete");
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, "error during shutdown");
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
