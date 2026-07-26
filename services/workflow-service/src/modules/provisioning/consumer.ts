import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { CONSUMED_EVENTS } from "../../topics.js";
import { definitions } from "../definitions/schema.js";
import * as defRepo from "../definitions/repo.js";
import { STANDARD_DEFINITIONS, linearEdges } from "./catalog.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

const AUDIT_TOPIC = "audit.event.record";

/**
 * Seed the standard workflow definitions (nodes + linear edges) into a tenant
 * when it is created. Idempotent: skips any definition code that already exists
 * for the tenant. This is what makes the SO→US→DS file-noting chain (and the
 * other standard chains) actually route for real tenants — migration 0003 only
 * covered the demo tenant and seeded no edges.
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

      for (const def of STANDARD_DEFINITIONS) {
        const existing = await defRepo.findByCodeTx(tx, tenantId, def.code);
        if (existing) continue; // already provisioned

        const definitionId = randomUUID();
        await tx.insert(definitions).values({
          id: definitionId,
          tenantId,
          code: def.code,
          name: def.name,
          version: 1,
          status: "active",
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
        });

        await defRepo.insertGraphTx(
          tx,
          definitionId,
          def.nodes.map((n, i) => ({
            nodeKey: n.nodeKey,
            name: n.name,
            roleRef: n.roleRef,
            nodeType: "task",
            sortOrder: i + 1,
          })),
          linearEdges(def).map((e, i) => ({ fromNode: e.fromNode, toNode: e.toNode, sortOrder: i + 1 })),
        );
      }

      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "workflow", action: "provision_definitions", resourceType: "workflow_definition", resourceId: tenantId, outcome: "success" },
      });
    });
  });
}
