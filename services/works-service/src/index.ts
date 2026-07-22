/**
 * works-service HTTP entrypoint.
 * Run the consumer/relay separately: `pnpm worker` (src/worker.ts).
 */
import { buildApp } from "./app.js";
import { sqlClient } from "./shared/db.js";

const port = Number(process.env.PORT ?? 3036);
const app = await buildApp();

await app.listen({ port, host: process.env.BIND_HOST ?? "127.0.0.1" });
app.log.info({ port }, "works-service listening");

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
