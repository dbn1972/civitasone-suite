import { registerGracefulShutdown, signalReady } from "@civitasone/observability";
import { buildApp } from "./app.js";
import { sqlClient } from "./shared/db.js";
import { assertPiiKeyAtBoot } from "./shared/pii-crypto.js";

// Fail closed outside development/test (same rule as ecosystem.config.js):
// DSC-config uploads seal the keystore passphrase with PII_ENC_KEY before
// anything is enqueued; refuse to start without it.
assertPiiKeyAtBoot();

const app = await buildApp();
const port = Number(process.env.PORT ?? 3013);
await app.listen({ port, host: process.env.BIND_HOST ?? "127.0.0.1" });
app.log.info({ port }, "payroll-service listening");

// PERF-003: tell PM2 (wait_ready in ecosystem.config.js) this process can now
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
