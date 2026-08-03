import { pino } from "pino";
import { db, sqlClient } from "./shared/db.js";
import { queue } from "./shared/infra.js";
import { startRelay } from "./shared/outbox.js";
import { startOutboxPurge } from "@civitasone/outbox";
import { registerTenantConsumers } from "./modules/tenants/consumer.js";
import { registerConfigConsumers } from "./modules/config/consumer.js";
import { registerBackupConsumers } from "./modules/backup/consumer.js";
import { registerSupportConsumers, startBreakGlassSweeper, sweepExpiredBreakGlass } from "./modules/support/consumer.js";
import { registerScheduledJobConsumers } from "./modules/scheduled-jobs/consumer.js";
import { registerCustomDomainConsumers } from "./modules/custom-domains/consumer.js";
import { registerWebhookConsumers } from "./modules/webhooks/consumer.js";
import { registerDataExportConsumers } from "./modules/data-export/consumer.js";
import { registerFeatureFlagConsumers } from "./modules/feature-flags/consumer.js";
// WC-009: subscriber for the admin.sandbox_refresh.execute command published by
// the approve route. Without this the command would have no consumer.
import { registerSandboxConsumers } from "./modules/sandbox/consumer.js";

const log = pino({ name: "admin-worker" });

registerTenantConsumers(queue);
registerConfigConsumers(queue);
registerBackupConsumers(queue);
registerSupportConsumers(queue);
registerScheduledJobConsumers(queue);
registerCustomDomainConsumers(queue);
registerWebhookConsumers(queue);
registerDataExportConsumers(queue);
registerFeatureFlagConsumers(queue);
// handleSandboxRefreshExecute wraps its own work in runWithTenant(), so it does
// not need the tenantScoped(queue) proxy.
registerSandboxConsumers(queue);

import { registerReconciliationConsumers } from "./modules/reconciliation-consumer.js";
registerReconciliationConsumers(queue);
import { registerSecurityComplianceConsumers } from "./modules/security-compliance/consumer.js";
import { registerSecurityIncidentConsumers } from "./modules/security-incident/consumer.js";
import { tenantScoped } from "./shared/tenant-queue.js";
import { registerApiKeyConsumers } from "./modules/api-keys/consumer.js";
import { registerMobileTelemetryConsumers } from "./modules/health/mobile-consumer.js";
import { registerF3_change_Consumers } from "./modules/change/f3-consumer.js";
import { registerF3_sandbox_Consumers } from "./modules/sandbox/f3-consumer.js";
import { registerF3_central_config_Consumers } from "./modules/central-config/f3-consumer.js";
import { registerF3_config_Consumers } from "./modules/config/artefact-f3-consumer.js";
import { registerF3_dept_templates_Consumers } from "./modules/dept-templates/f3-consumer.js";
import { registerF3_integration_settings_Consumers } from "./modules/integration-settings/f3-consumer.js";
import { registerF3_uploads_Consumers } from "./modules/uploads/doc-f3-consumer.js";
import { registerF3_support_Consumers } from "./modules/support/f3-consumer.js";
import { registerIntegrationOpsConsumers } from "./modules/integration-ops/consumer.js";
registerSecurityComplianceConsumers(tenantScoped(queue));
registerSecurityIncidentConsumers(tenantScoped(queue));
registerApiKeyConsumers(tenantScoped(queue));
registerMobileTelemetryConsumers(tenantScoped(queue));
registerF3_change_Consumers(tenantScoped(queue));
registerF3_sandbox_Consumers(tenantScoped(queue));
registerF3_central_config_Consumers(tenantScoped(queue));
registerF3_config_Consumers(tenantScoped(queue));
registerF3_dept_templates_Consumers(tenantScoped(queue));
registerF3_integration_settings_Consumers(tenantScoped(queue));
registerF3_uploads_Consumers(tenantScoped(queue));
registerF3_support_Consumers(tenantScoped(queue));
registerIntegrationOpsConsumers(tenantScoped(queue));
await queue.start();
const relay = startRelay(db, queue);
// G7: scheduled outbox purge — remove published messages older than 7 days.
const purge = startOutboxPurge(db as unknown as Parameters<typeof startOutboxPurge>[0], {
  intervalMs: 60 * 60_000,
  batchSize: 1000,
  logger: log,
});

// P1-2: periodically auto-close break-glass grants past their TTL.
const breakGlassSweepMs = Number(process.env.BREAK_GLASS_SWEEP_MS ?? 60_000);
const breakGlassSweeper = startBreakGlassSweeper(breakGlassSweepMs);
// Run one sweep immediately on boot so grants that expired while the worker was
// down are closed without waiting a full interval.
void sweepExpiredBreakGlass()
  .then((n) => { if (n > 0) log.info({ swept: n }, "break-glass: closed expired grants on boot"); })
  .catch((err) => log.error({ err }, "break-glass sweep failed"));

log.info("admin-service worker: consumers + outbox relay + break-glass sweeper running");

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(purge);
  clearInterval(relay);
  clearInterval(breakGlassSweeper);
  await queue.stop();
  await sqlClient.end();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT",  () => void shutdown("SIGINT"));
