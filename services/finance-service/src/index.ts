import { registerGracefulShutdown, signalReady } from "@civitasone/observability";
import { buildApp } from "./app.js";

const app = await buildApp();
const port = Number(process.env.PORT ?? 3007);
await app.listen({ port, host: process.env.BIND_HOST ?? "127.0.0.1" });
app.log.info({ port }, "finance-service listening");

// REL-012: tell PM2 (wait_ready in ecosystem.config.js) this process can now
// actually take traffic — not just that the process started.
signalReady();

registerGracefulShutdown({
  cleanup: async () => {
    await app.close();
  },
  logger: app.log,
});
