import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, CONSUMED_EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

/** Option B: a silo tenant's dedicated DB name (matches provision-silo-tenant.mjs). */
function siloDbName(tenantId: string): string {
  return `civitas_tenant_${tenantId.replace(/-/g, "").slice(0, 16)}`;
}

type IsolationChanged = { tenantId: string; tier: "pool" | "silo" };
type ProvisionUpdate = {
  id: string; tenantId: string; status: "provisioning" | "ready" | "failed";
  error?: string | null; steps?: Array<{ step: string; ok: boolean; detail?: string }>;
};

export function registerProvisioningConsumers(queue: Queue): void {
  // A tenant was flipped to silo → record a provisioning request (idempotent).
  queue.subscribe(CONSUMED_EVENTS.tenantIsolationChanged, async (msg) => {
    const p = msg.payload as IsolationChanged;
    if (p.tier !== "silo") return; // pool: nothing to provision
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const existing = await repo.findByTenantTx(tx, p.tenantId);
      if (existing) return; // already tracked
      const id = randomUUID();
      await repo.insert(tx, {
        id, tenantId: p.tenantId, dbName: siloDbName(p.tenantId),
        status: "requested", steps: [], createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "install", action: "silo_provision.requested", resourceType: "silo_provision", resourceId: id, outcome: "success", metadata: { dbName: siloDbName(p.tenantId) } },
      });
    });
  });

  // Runner/ops reports provisioning progress.
  queue.subscribe(COMMANDS.siloProvisionUpdate, async (msg) => {
    const p = msg.payload as ProvisionUpdate;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const cur = await repo.findByIdTenantTx(tx, p.id, p.tenantId);
      if (!cur) return;
      const patch: Parameters<typeof repo.update>[2] = {
        status: p.status, updatedBy: msg.actorId, version: cur.version + 1,
      };
      if (p.error !== undefined) patch.error = p.error;
      if (p.steps !== undefined) patch.steps = p.steps;
      if (p.status === "ready") patch.readyAt = new Date();
      await repo.update(tx, p.id, patch);
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "install", action: `silo_provision.${p.status}`, resourceType: "silo_provision", resourceId: p.id, outcome: "success", metadata: {} },
      });
    });
  });
}
