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
      // TX-001 (procurement) — all bare (non-tx) reads/write in this handler
      // routed through their *Tx siblings: each used to open its own nested
      // db.transaction()/bare execute from inside this already-open one,
      // risking pool exhaustion under load, and — for the write below —
      // silently running with no app.tenant_id GUC set under FORCE RLS
      // (the same split-brain shape TX-002 fixed for reinstate() in this file).
      const vendor = await vendorRepo.findVendorByIdTx(tx, p.vendorId, p.tenantId);
      if (!vendor) throw new Error(`vendor ${p.vendorId} not found`);
      const existing = await repo.findActiveTx(tx, p.tenantId, p.vendorId);
      if (existing) return; // idempotent

      await repo.insertBlacklistTx(tx, {

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
      // TX-001 (procurement) — findActive/findVendorById routed through
      // their *Tx siblings for the same nested-tx reason as the add handler
      // above; reinstateTx itself was already fixed under TX-002.
      const entry = await repo.findActiveTx(tx, p.tenantId, p.vendorId);
      if (!entry) return;
      await repo.reinstateTx(tx, p.tenantId, p.vendorId, msg.actorId);
      const vendor = await vendorRepo.findVendorByIdTx(tx, p.vendorId, p.tenantId);
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
      // TX-001 (procurement) — same nested-tx fix as the add/reinstate
      // handlers above.
      const existing = await repo.findActiveCentralByPanTx(tx, p.pan);
      if (existing) return;
      await repo.insertBlacklistTx(tx, {

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
