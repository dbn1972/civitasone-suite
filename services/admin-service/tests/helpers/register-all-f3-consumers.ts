/**
 * F3 CONSUMER WIRING — WHY THIS EXISTS:
 *
 * admin-service's F3 async-write consumers (and its older non-F3 command
 * consumers) are registered only in src/worker.ts, which runs as a separate
 * deployment process from the API server (src/app.ts / src/index.ts). In
 * production that's fine — worker.ts owns a real SQS queue. But the test
 * suite builds its Fastify app from app.ts alone, with QUEUE_DRIVER=memory
 * (an in-process Queue whose publish() only invokes handlers registered on
 * that same Queue instance). Since no test ever registered a consumer
 * against its own Queue singleton, every write that goes through
 * queue.publish() (propose/approve flows, F3-converted routes, etc.)
 * returns 202 but the command is never applied — repo reads afterwards see
 * nothing, and routes downstream of "does this exist yet" fail-close on
 * whatever guard fires first (usually a 404/409), never reaching the logic
 * the test actually meant to exercise.
 *
 * PR #921 first hit this for tests/integration-settings-ssrf.test.ts and
 * fixed it locally by registering ONE consumer (registerF3_integration_settings_Consumers,
 * tenantScoped) in that file's beforeAll. This helper generalizes that fix:
 * it registers the COMPLETE set of consumers worker.ts registers — not a
 * reimplementation, the exact same imported functions, wrapped exactly the
 * same way (tenantScoped(queue) where worker.ts wraps it, bare queue where
 * it doesn't) — so any test file can pull in the whole set with one call
 * instead of hand-picking whichever consumer its own routes happen to need.
 *
 * Usage (mirrors tests/feature-flags-rollout.test.ts):
 *
 *   import { queue } from "../src/shared/infra.js";
 *   import { registerAllF3Consumers } from "./helpers/register-all-f3-consumers.js";
 *
 *   beforeAll(async () => {
 *     registerAllF3Consumers(queue);
 *     await queue.start();
 *     app = await buildApp();
 *   });
 *   afterAll(async () => { await app.close(); await queue.stop(); await sqlClient.end(); });
 *
 * Keep this list in sync with src/worker.ts. If worker.ts registers a new
 * consumer and this file isn't updated, that consumer's writes will keep
 * silently failing to land in every test that uses this helper — exactly
 * the class of bug this helper exists to close.
 */
import type { Queue } from "@civitasone/queue";
import { tenantScoped } from "../../src/shared/tenant-queue.js";

import { registerTenantConsumers } from "../../src/modules/tenants/consumer.js";
import { registerConfigConsumers } from "../../src/modules/config/consumer.js";
import { registerBackupConsumers } from "../../src/modules/backup/consumer.js";
import { registerSupportConsumers } from "../../src/modules/support/consumer.js";
import { registerScheduledJobConsumers } from "../../src/modules/scheduled-jobs/consumer.js";
import { registerCustomDomainConsumers } from "../../src/modules/custom-domains/consumer.js";
import { registerWebhookConsumers } from "../../src/modules/webhooks/consumer.js";
import { registerDataExportConsumers } from "../../src/modules/data-export/consumer.js";
import { registerFeatureFlagConsumers } from "../../src/modules/feature-flags/consumer.js";
// WC-009: subscriber for admin.sandbox_refresh.execute, published by the
// approve route. handleSandboxRefreshExecute wraps its own work in
// runWithTenant(), so — matching worker.ts — it is registered against the
// bare queue, not tenantScoped(queue).
import { registerSandboxConsumers } from "../../src/modules/sandbox/consumer.js";
import { registerReconciliationConsumers } from "../../src/modules/reconciliation-consumer.js";

import { registerSecurityComplianceConsumers } from "../../src/modules/security-compliance/consumer.js";
import { registerSecurityIncidentConsumers } from "../../src/modules/security-incident/consumer.js";
import { registerApiKeyConsumers } from "../../src/modules/api-keys/consumer.js";
import { registerMobileTelemetryConsumers } from "../../src/modules/health/mobile-consumer.js";
import { registerF3_change_Consumers } from "../../src/modules/change/f3-consumer.js";
import { registerF3_sandbox_Consumers } from "../../src/modules/sandbox/f3-consumer.js";
import { registerF3_central_config_Consumers } from "../../src/modules/central-config/f3-consumer.js";
import { registerF3_config_Consumers } from "../../src/modules/config/artefact-f3-consumer.js";
import { registerF3_dept_templates_Consumers } from "../../src/modules/dept-templates/f3-consumer.js";
import { registerF3_integration_settings_Consumers } from "../../src/modules/integration-settings/f3-consumer.js";
import { registerF3_uploads_Consumers } from "../../src/modules/uploads/doc-f3-consumer.js";
import { registerF3_support_Consumers } from "../../src/modules/support/f3-consumer.js";
import { registerIntegrationOpsConsumers } from "../../src/modules/integration-ops/consumer.js";

/**
 * Registers every consumer src/worker.ts registers, against the given Queue
 * instance (pass the real `queue` singleton from src/shared/infra.js — the
 * same one QUEUE_DRIVER=memory's publish() dispatches through). Idempotent
 * per Queue instance is NOT guaranteed — call this once per test file, in
 * beforeAll, before queue.start().
 */
export function registerAllF3Consumers(queue: Queue): void {
  // Same order as worker.ts.
  registerTenantConsumers(queue);
  registerConfigConsumers(queue);
  registerBackupConsumers(queue);
  registerSupportConsumers(queue);
  registerScheduledJobConsumers(queue);
  registerCustomDomainConsumers(queue);
  registerWebhookConsumers(queue);
  registerDataExportConsumers(queue);
  registerFeatureFlagConsumers(queue);
  registerSandboxConsumers(queue);
  registerReconciliationConsumers(queue);

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
}
