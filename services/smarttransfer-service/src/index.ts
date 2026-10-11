import { registerGracefulShutdown, signalReady } from "@civitasone/observability";
import { buildApp } from "./app.js";
import { sqlClient } from "./shared/db.js";

const port = Number(process.env.PORT ?? 3086);
const app = await buildApp();
await app.listen({ port, host: process.env.BIND_HOST ?? "127.0.0.1" });
app.log.info(`smarttransfer-service (API) listening on :${port}`);

signalReady();

registerGracefulShutdown({
  cleanup: async () => {
    await app.close();
    await sqlClient.end();
  },
  logger: app.log,
  server: app.server,
});
