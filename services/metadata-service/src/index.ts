import { registerGracefulShutdown, signalReady } from "@civitasone/observability";
import { buildApp } from "./app.js";
import { sqlClient } from "./shared/db.js";
// 3039 matches this service's gateway registry entry. The previous default of
// 3036 collided with works-service and pointed nowhere the gateway proxies to.
const PORT = Number(process.env.PORT ?? 3039);
const app = await buildApp();
await app.listen({ port: PORT, host: "0.0.0.0" });

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
