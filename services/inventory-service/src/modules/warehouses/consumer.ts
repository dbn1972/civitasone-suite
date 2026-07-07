/**
 * warehouses module — command consumer (CQRS write side).
 */
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { warehouses } from "./schema.js";
import { COMMANDS, EVENTS, INTEGRATION, RESOURCE } from "../../topics.js";
import { eq, and } from "drizzle-orm";
import { cache } from "../../shared/infra.js";

export function registerWarehouseConsumers(q: Queue): void {
  q.subscribe(COMMANDS.warehouseCreate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const p = msg.payload as {
        id: string; tenantId: string; name: string; code: string; address?: string;
      };

      await tx.insert(warehouses).values({
        id: p.id,
        tenantId: p.tenantId,
        name: p.name,
        code: p.code,
        address: p.address ?? null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: EVENTS.warehouseCreated,
        eventType: EVENTS.warehouseCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { warehouseId: p.id, name: p.name, code: p.code },
      });
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: INTEGRATION.audit,
        eventType: INTEGRATION.audit,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: "inventory", action: "create", resourceType: "warehouse", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidateResource(msg.tenantId, RESOURCE.warehouse);
  });

  q.subscribe(COMMANDS.warehouseUpdate, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const p = msg.payload as {
        id: string; tenantId: string; name?: string; code?: string;
        address?: string | null; isActive?: boolean; version: number;
      };

      const existing = await tx.select().from(warehouses)
        .where(and(eq(warehouses.tenantId, p.tenantId), eq(warehouses.id, p.id)))
        .limit(1);
      if (!existing[0]) return;
      if (existing[0].version !== p.version) return;

      const updates: Record<string, unknown> = { updatedBy: msg.actorId };
      if (p.name !== undefined) updates.name = p.name;
      if (p.code !== undefined) updates.code = p.code;
      if (p.address !== undefined) updates.address = p.address;
      if (p.isActive !== undefined) updates.isActive = p.isActive;

      await tx.update(warehouses)
        .set({ ...updates, version: existing[0].version + 1 } as typeof warehouses.$inferInsert)
        .where(and(eq(warehouses.tenantId, p.tenantId), eq(warehouses.id, p.id)));

      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: EVENTS.warehouseUpdated,
        eventType: EVENTS.warehouseUpdated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { warehouseId: p.id, changes: updates },
      });
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: INTEGRATION.audit,
        eventType: INTEGRATION.audit,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: "inventory", action: "update", resourceType: "warehouse", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidateResource(msg.tenantId, RESOURCE.warehouse);
  });
}
