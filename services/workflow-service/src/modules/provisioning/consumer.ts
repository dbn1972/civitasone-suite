import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { CONSUMED_EVENTS } from "../../topics.js";
import { definitionsForClusters, seedClustersFromEnv } from "./catalog.js";
import { seedDefinitionsTx } from "./seed.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

const AUDIT_TOPIC = "audit.event.record";

/**
 * Seed the standard workflow definitions (nodes + linear edges) into a tenant
 * when it is created. Idempotent: skips any definition code that already exists
 * for the tenant. This is what makes the SO→US→DS file-noting chain (and the
 * other standard chains) actually route for real tenants — migration 0003 only
 * covered the demo tenant and seeded no edges. Tenants provisioned before a
 * code joined the catalogue are repaired by src/scripts/backfill-standard-
 * definitions.ts, which runs the same seedDefinitionsTx.
 */
export function registerProvisioningConsumers(queue: Queue): void {
  // RLS (#146): run the handler inside the message's tenant context so
  // db.transaction() sets the app.tenant_id GUC (workflow_svc is NOBYPASSRLS).
  queue = tenantScoped(queue);
  queue.subscribe(CONSUMED_EVENTS.tenantCreated, async (msg) => {
    const p = msg.payload as { tenantId?: string };
    const tenantId = p.tenantId;
    if (!tenantId) return;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // ST-M01-03: seed only the standard definitions whose module cluster is
      // enabled for this deployment. Default = every cluster (unchanged for
      // existing tenants); a SmartTransfer-standalone deployment narrows this
      // via WORKFLOW_SEED_CLUSTERS so the HR/finance/procurement/grant chains
      // are not seeded for a tenant that has none of those modules.
      await seedDefinitionsTx(tx, tenantId, msg.actorId, definitionsForClusters(seedClustersFromEnv()));

      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "workflow", action: "provision_definitions", resourceType: "workflow_definition", resourceId: tenantId, outcome: "success" },
      });
    });
  });
}
