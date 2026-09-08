import { pino } from "pino";
import { registerGracefulShutdown, signalReady } from "@civitasone/observability";
import { buildApp } from "./app.js";
import { validatePiiEncKey } from "./shared/validate-env.js";
import { sqlClient } from "./shared/db.js";

// Fail-fast: validate PII_ENC_KEY before any other initialization (Req 2.6)
const piiKeyError = validatePiiEncKey(process.env.PII_ENC_KEY);
if (piiKeyError) {
  const logger = pino({ level: "error" });
  logger.error(piiKeyError);
  process.exit(1);
}

const app = await buildApp();
const port = Number(process.env.PORT ?? 3008);
await app.listen({ port, host: process.env.BIND_HOST ?? "127.0.0.1" });
app.log.info({ port }, "procurement-service listening");

// PERF-003: tell PM2 (wait_ready in ecosystem.config.js) this process can now
// actually take traffic — not just that the process started.
signalReady();

registerGracefulShutdown({
  cleanup: async () => {
    await app.close();
    await sqlClient.end();
  },
  logger: app.log,
});
