import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { legalEntities, operatingUnits, costCenters, profitCenters } from "./schema.js";

const log = pino({ name: "finance.org-structure.consumer" });

const AUDIT_TOPIC = "audit.event.record";

export function registerOrgStructureConsumers(queue: Queue): void {
  queue.subscribe("finance.org_structure.legal_entity_create", async (msg) => {
    const p = msg.payload as {
      id?: string; tenantId: string; code: string; name: string;
      entityType?: string; parentEntityId?: string; gstin?: string; pan?: string;
      tan?: string; cin?: string; currency?: string; fiscalYearStart?: string;
      ddoCode?: string; paoCode?: string; treasuryCode?: string; locationId?: string;
      registeredAddress?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const id = p.id ?? randomUUID();
      await tx.insert(legalEntities).values({
        id, tenantId: p.tenantId, code: p.code, name: p.name,
        entityType: p.entityType ?? "company",
        ...(p.parentEntityId ? { parentEntityId: p.parentEntityId } : {}),
        ...(p.gstin ? { gstin: p.gstin } : {}),
        ...(p.pan ? { pan: p.pan } : {}),
        ...(p.tan ? { tan: p.tan } : {}),
        ...(p.cin ? { cin: p.cin } : {}),
        currency: p.currency ?? "INR",
        fiscalYearStart: p.fiscalYearStart ?? "04-01",
        ...(p.ddoCode ? { ddoCode: p.ddoCode } : {}),
        ...(p.paoCode ? { paoCode: p.paoCode } : {}),
        ...(p.treasuryCode ? { treasuryCode: p.treasuryCode } : {}),
        ...(p.locationId ? { locationId: p.locationId } : {}),
        ...(p.registeredAddress ? { registeredAddress: p.registeredAddress } : {}),
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: "finance.org_structure.legal_entity_created", eventType: "finance.org_structure.legal_entity_created",
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id, code: p.code, name: p.name },
      });
      await audit(tx, msg, "create", "legal_entity", id);
    });
    await cache.invalidate(`finance:${msg.tenantId}:org_structure:*`);
    log.info({ id: msg.messageId }, "Processed org_structure.legal_entity_create");
  });

  queue.subscribe("finance.org_structure.operating_unit_create", async (msg) => {
    const p = msg.payload as {
      id?: string; tenantId: string; legalEntityId: string; code: string;
      name: string; unitType?: string; locationId?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const id = p.id ?? randomUUID();
      await tx.insert(operatingUnits).values({
        id, tenantId: p.tenantId, legalEntityId: p.legalEntityId,
        code: p.code, name: p.name, unitType: p.unitType ?? "branch",
        ...(p.locationId ? { locationId: p.locationId } : {}),
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: "finance.org_structure.operating_unit_created", eventType: "finance.org_structure.operating_unit_created",
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id, code: p.code, name: p.name },
      });
      await audit(tx, msg, "create", "operating_unit", id);
    });
    await cache.invalidate(`finance:${msg.tenantId}:org_structure:*`);
    log.info({ id: msg.messageId }, "Processed org_structure.operating_unit_create");
  });

  queue.subscribe("finance.org_structure.cost_center_create", async (msg) => {
    const p = msg.payload as {
      id?: string; tenantId: string; legalEntityId: string; code: string;
      name: string; parentId?: string; departmentId?: string; managerId?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const id = p.id ?? randomUUID();
      await tx.insert(costCenters).values({
        id, tenantId: p.tenantId, legalEntityId: p.legalEntityId,
        code: p.code, name: p.name,
        ...(p.parentId ? { parentId: p.parentId } : {}),
        ...(p.departmentId ? { departmentId: p.departmentId } : {}),
        ...(p.managerId ? { managerId: p.managerId } : {}),
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: "finance.org_structure.cost_center_created", eventType: "finance.org_structure.cost_center_created",
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id, code: p.code, name: p.name },
      });
      await audit(tx, msg, "create", "cost_center", id);
    });
    await cache.invalidate(`finance:${msg.tenantId}:org_structure:*`);
    log.info({ id: msg.messageId }, "Processed org_structure.cost_center_create");
  });

  queue.subscribe("finance.org_structure.profit_center_create", async (msg) => {
    const p = msg.payload as {
      id?: string; tenantId: string; legalEntityId: string; code: string;
      name: string; parentId?: string; segment?: string; managerId?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const id = p.id ?? randomUUID();
      await tx.insert(profitCenters).values({
        id, tenantId: p.tenantId, legalEntityId: p.legalEntityId,
        code: p.code, name: p.name,
        ...(p.parentId ? { parentId: p.parentId } : {}),
        ...(p.segment ? { segment: p.segment } : {}),
        ...(p.managerId ? { managerId: p.managerId } : {}),
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: "finance.org_structure.profit_center_created", eventType: "finance.org_structure.profit_center_created",
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { id, code: p.code, name: p.name },
      });
      await audit(tx, msg, "create", "profit_center", id);
    });
    await cache.invalidate(`finance:${msg.tenantId}:org_structure:*`);
    log.info({ id: msg.messageId }, "Processed org_structure.profit_center_create");
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "finance", action, resourceType, resourceId, outcome: "success" },
  });
}
