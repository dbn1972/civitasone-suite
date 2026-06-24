import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { assertCanEmpanel } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerVendorConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.vendorCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; name: string; gstin?: string; pan?: string;
      email?: string; phone?: string; mse: boolean; msme: boolean;
      udyamNo?: string; bankAccount?: string; ifsc?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertVendor(tx, {
        id: p.id, tenantId: p.tenantId, name: p.name,
        gstin: p.gstin ?? null, pan: p.pan ?? null,
        email: p.email ?? null, phone: p.phone ?? null,
        vendorType: "registered", mse: p.mse, msme: p.msme,
        udyamNo: p.udyamNo ?? null, bankAccount: p.bankAccount ?? null, ifsc: p.ifsc ?? null,
        blacklistReason: null, createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "vendor", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "vendor", p.id));
  });

  queue.subscribe(COMMANDS.vendorEmpanel, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; category: string; validUntil?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const vendor = await repo.findVendorByIdTx(tx, p.id, p.tenantId);
      if (!vendor) throw new Error(`vendor ${p.id} not found`);
      assertCanEmpanel(vendor.vendorType ?? "registered");
      await repo.updateVendorVersioned(tx, p.id, vendor.version ?? 1, { vendorType: "empanelled", updatedBy: msg.actorId });
      await repo.insertEmpanelment(tx, {
        id: randomUUID(), vendorId: p.id, tenantId: p.tenantId,
        category: p.category, empanelDate: new Date().toISOString().slice(0, 10),
        validUntil: p.validUntil ?? null, status: "active",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "empanel", "vendor", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "vendor", p.id));
  });

  queue.subscribe(COMMANDS.vendorBlacklist, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const vendor = await repo.findVendorByIdTx(tx, p.id, p.tenantId);
      if (!vendor) throw new Error(`vendor ${p.id} not found`);
      await repo.updateVendorVersioned(tx, p.id, vendor.version ?? 1, {
        vendorType: "blacklisted", blacklistReason: p.reason, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.vendorBlacklisted, eventType: EVENTS.vendorBlacklisted,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { vendorId: p.id, reason: p.reason },
      });
      await enqueue(tx, {
        topic: NOTIFICATION_SEND, eventType: NOTIFICATION_SEND,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: buildNotificationPayload({
          eventType: EVENTS.vendorBlacklisted,
          recipient: vendor.email ?? vendor.id,
          recipientId: vendor.id,
          channel: "email",
          variables: { vendorId: p.id, reason: p.reason },
        }),
      });
      await audit(tx, msg, "blacklist", "vendor", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "vendor", p.id));
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "procurement", action, resourceType, resourceId, outcome: "success" },
  });
}
