import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { cache } from "../../shared/infra.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "market.properties.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerPropertyConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.createProperty, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      propertyCode: string;
      marketName: string;
      propertyType: string;
      location?: Record<string, unknown>;
      area?: string;
      areaUnit?: string;
      floorNumber?: number;
      monthlyRentMinor?: number;
      securityDepositMinor?: number;
    };

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertProperty(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        propertyCode: p.propertyCode,
        marketName: p.marketName,
        propertyType: p.propertyType,
        location: (p.location as never) ?? null,
        area: p.area ?? null,
        areaUnit: p.areaUnit ?? "sqft",
        floorNumber: p.floorNumber ?? null,
        monthlyRentMinor: p.monthlyRentMinor ? BigInt(p.monthlyRentMinor) : null,
        securityDepositMinor: p.securityDepositMinor ? BigInt(p.securityDepositMinor) : null,
        currency: "INR",
        status: "available",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.propertyCreated,
        eventType: EVENTS.propertyCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { propertyId: p.id, propertyCode: p.propertyCode, marketName: p.marketName },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "property.create",
        resourceType: "market_property",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id, propertyCode: p.propertyCode }, "market property created");
  });

  queue.subscribe(COMMANDS.updateProperty, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; [key: string]: unknown };
    let updated = false;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const data: Record<string, unknown> = {};
      for (const key of ["marketName", "status", "area", "areaUnit"]) {
        if (p[key] !== undefined) data[key] = p[key];
      }
      if (p.monthlyRentMinor !== undefined) data.monthlyRentMinor = BigInt(p.monthlyRentMinor as number);
      if (p.securityDepositMinor !== undefined) data.securityDepositMinor = BigInt(p.securityDepositMinor as number);
      const ok = await repo.updateProperty(tx, p.id, msg.tenantId, data as never, msg.actorId);
      if (!ok) return;
      updated = true;
      await enqueue(tx, {
        topic: EVENTS.propertyUpdated,
        eventType: EVENTS.propertyUpdated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { propertyId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "property.update",
        resourceType: "market_property",
        resourceId: p.id,
      });
    });
    // Re-review fix: this used to call cache.invalidate() INSIDE the
    // transaction, before commit — a concurrent GET could repopulate the
    // cache with the pre-update row in the window between the invalidation
    // and the actual commit, leaving it stale until the next write. Moved
    // outside/after the transaction, matching allotments/consumer.ts's
    // (already-correct) cache.put() placement in this same PR, and
    // @civitasone/cache's own documented rule that invalidation must happen
    // after commit, not before.
    if (updated) {
      await cache.invalidate(`market:${msg.tenantId}:property:${p.id}`);
    }
  });
}
