import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as vendorRepo from "../vendor/repo.js";

const log = pino({ name: "procurement.vendor-blacklist.consumer" });
const AUDIT_TOPIC = "audit.event.record";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

export function registerVendorBlacklistConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.vendorBlacklistAdd, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      vendorId: string;
      reason: string;
      blacklistedFrom: string;
      blacklistedUntil?: string | null;
      orderRef?: string | null;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const vendor = await vendorRepo.findVendorById(p.vendorId, p.tenantId);
      if (!vendor) throw new Error(`vendor ${p.vendorId} not found`);
      const existing = await repo.findActive(p.tenantId, p.vendorId);
      if (existing) return; // idempotent

      await repo.insertBlacklist({

        id: p.id,
        tenantId: p.tenantId,
        vendorId: p.vendorId,
        reason: p.reason,
        blacklistedBy: msg.actorId,
        createdBy: msg.actorId,
        blacklistedFrom: p.blacklistedFrom,
        blacklistedUntil: p.blacklistedUntil ?? null,
        orderRef: p.orderRef ?? null,
        status: "active",
      });
      await vendorRepo.updateVendor(tx, p.vendorId, {
        vendorType: "blacklisted",
        blacklistReason: p.reason,
        updatedBy: msg.actorId,
        version: (vendor.version ?? 1) + 1,
      });
      await enqueue(tx, {
        topic: EVENTS.vendorBlacklisted,
        eventType: EVENTS.vendorBlacklisted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { vendorId: p.vendorId, reason: p.reason },
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "procurement",
          action: "blacklist",
          resourceType: "vendor",
          resourceId: p.vendorId,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "vendor", p.vendorId));
    log.info({ id: msg.messageId }, "Processed vendor_blacklist.add");
  });

  queue.subscribe(COMMANDS.vendorBlacklistReinstate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; vendorId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const entry = await repo.findActive(p.tenantId, p.vendorId);
      if (!entry) return;
      await repo.reinstate(p.tenantId, p.vendorId, msg.actorId);
      const vendor = await vendorRepo.findVendorById(p.vendorId, p.tenantId);
      if (vendor) {
        await vendorRepo.updateVendor(tx, p.vendorId, {
          vendorType: "registered",
          updatedBy: msg.actorId,
          version: (vendor.version ?? 1) + 1,
        });
      }
      await enqueue(tx, {
        topic: "procurement.vendor.reinstated",
        eventType: "procurement.vendor.reinstated",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { vendorId: p.vendorId },
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "procurement",
          action: "reinstate",
          resourceType: "vendor",
          resourceId: p.vendorId,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "vendor", p.vendorId));
    log.info({ id: msg.messageId }, "Processed vendor_blacklist.reinstate");
  });

  queue.subscribe(COMMANDS.vendorCentralDebar, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      pan: string;
      reason: string;
      blacklistedFrom: string;
      blacklistedUntil?: string | null;
      orderRef?: string | null;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const existing = await repo.findActiveCentralByPan(p.pan);
      if (existing) return;
      await repo.insertBlacklist({

        id: p.id,
        tenantId: p.tenantId,
        vendorId: NIL_UUID,
        scope: "central",
        pan: p.pan,
        reason: p.reason,
        blacklistedBy: msg.actorId,
        createdBy: msg.actorId,
        blacklistedFrom: p.blacklistedFrom,
        blacklistedUntil: p.blacklistedUntil ?? null,
        orderRef: p.orderRef ?? null,
        status: "active",
      });
      await enqueue(tx, {
        topic: "procurement.vendor.central_debarred",
        eventType: "procurement.vendor.central_debarred",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { pan: p.pan, reason: p.reason },
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "procurement",
          action: "central_debar",
          resourceType: "vendor_pan",
          resourceId: p.pan,
          outcome: "success",
        },
      });
    });
    log.info({ id: msg.messageId }, "Processed vendor_blacklist.central_debar");
  });
}
