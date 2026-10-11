import { pino } from "pino";
import { startRelay, startOutboxPurge } from "@civitasone/outbox";
import { db, sqlClient } from "./shared/db.js";
import { scannerDb, scannerSqlClient } from "./shared/scanner-db.js";
import { queue } from "./shared/infra.js";
import { SERVICE } from "./topics.js";
import { registerMovementConsumers } from "./modules/movement/consumer.js";

const log = pino({ name: "smarttransfer-worker" });

// Fail closed in production: _outbox.messages / _inbox.command_results are FORCE
// RLS, so the cross-tenant relay/purge must use the BYPASSRLS scanner DSN and
// must never silently fall back to the NOBYPASSRLS service role.
if ((process.env.NODE_ENV ?? "") === "production") {
  const scanner = process.env.SMARTTRANSFER_SCANNER_DATABASE_URL ?? "";
  if (!scanner || scanner === (process.env.DATABASE_URL ?? "")) {
    throw new Error(
      "SMARTTRANSFER_SCANNER_DATABASE_URL must be set and distinct from DATABASE_URL in production " +
        "(BYPASSRLS scanner role required for outbox relay/purge under FORCE RLS)",
    );
  }
}

registerMovementConsumers(queue);

await queue.start();
// Cross-tenant relay + purge run on the BYPASSRLS scanner pool (FORCE RLS on the
// outbox tables hides every row from smarttransfer_svc when no GUC is set).
const relay = startRelay(scannerDb as unknown as typeof db, queue, 1000, SERVICE);

// D-20: purge published outbox rows, consumed inbox markers AND
// _inbox.command_results on the shared retention window (purgeOutbox covers
// command_results too). Scanner role only, per D-20.
const purge = startOutboxPurge(scannerDb as unknown as Parameters<typeof startOutboxPurge>[0], { logger: log });

log.info("smarttransfer-service worker: command consumers + outbox relay + purge running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(relay);
  clearInterval(purge);
  await queue.stop();
  await sqlClient.end();
  await scannerSqlClient.end();
  log.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
