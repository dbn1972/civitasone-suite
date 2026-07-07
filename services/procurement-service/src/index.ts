import { pino } from "pino";
import { buildApp } from "./app.js";
import { validatePiiEncKey } from "./shared/validate-env.js";

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
