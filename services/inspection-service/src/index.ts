/**
 * inspection-service HTTP server entrypoint.
 * Port: 3036 | Gateway prefix: /api/v1/inspection
 *
 * Graceful shutdown: SIGTERM → drain in-flight requests → close DB pool → exit.
 *
 * _Requirements: 1.1, 1.5, 1.9_
 */
import { buildApp } from "./app.js";
import { sqlClient } from "./shared/db.js";

const PORT = Number(process.env.PORT ?? 3036);
const HOST = process.env.HOST ?? "0.0.0.0";

const app = await buildApp();

await app.listen({ port: PORT, host: HOST });
app.log.info({ port: PORT, host: HOST }, "inspection-service listening");

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "shutting down");
  await app.close(); // drain in-flight requests
  await sqlClient.end(); // close DB pool
  app.log.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
