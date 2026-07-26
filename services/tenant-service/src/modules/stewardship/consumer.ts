/**
 * stewardship consumers (CAP-019) — the only writers of the data-governance
 * tables. Each handler runs inside runWithTenant so FORCED RLS accepts the
 * write; steward/asset assignments verify the parent domain exists in-tenant.
 */
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";
const log = pino({ name: "stewardship-consumer" });

export function registerStewardshipConsumers(q: Queue): void {
  q.subscribe("tenant.data_domain.create", async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; code: string; name: string; description?: string; ownerOffice: string; ownerRole: string; classification: string };
    await runWithTenant(msg.tenantId, () => db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertDomain(tx, {
        id: p.id, tenantId: p.tenantId, code: p.code, name: p.name,
        description: p.description ?? null, ownerOffice: p.ownerOffice, ownerRole: p.ownerRole,
        classification: p.classification, createdBy: msg.actorId,
      });
      await audit(tx, msg, "create_data_domain", "data_domain", p.id);
    }));
  });

  q.subscribe("tenant.data_steward.assign", async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; domainId: string; stewardUserId: string; role: string };
    await runWithTenant(msg.tenantId, () => db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      if (!(await repo.findDomainTx(tx, p.tenantId, p.domainId))) { log.warn({ domainId: p.domainId }, "steward.assign: domain missing"); return; }
      await repo.insertSteward(tx, { id: p.id, tenantId: p.tenantId, domainId: p.domainId, stewardUserId: p.stewardUserId, role: p.role, createdBy: msg.actorId });
      await audit(tx, msg, "assign_data_steward", "data_steward", p.id);
    }));
  });

  q.subscribe("tenant.data_asset.register", async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; domainId: string; name: string; assetType: string; classification: string; systemOfRecord?: string };
    await runWithTenant(msg.tenantId, () => db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      if (!(await repo.findDomainTx(tx, p.tenantId, p.domainId))) { log.warn({ domainId: p.domainId }, "asset.register: domain missing"); return; }
      await repo.insertAsset(tx, {
        id: p.id, tenantId: p.tenantId, domainId: p.domainId, name: p.name,
        assetType: p.assetType, classification: p.classification, systemOfRecord: p.systemOfRecord ?? null, createdBy: msg.actorId,
      });
      await audit(tx, msg, "register_data_asset", "data_asset", p.id);
    }));
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function audit(tx: Tx, msg: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "tenant", action, resourceType, resourceId, outcome: "success" } });
}
