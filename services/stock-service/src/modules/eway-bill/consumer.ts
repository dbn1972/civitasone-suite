import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import * as nicClient from "./nic-ewb-client.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerEwayBillConsumers(queue: Queue): void {
  // --- Generate e-Way Bill ---
  queue.subscribe(COMMANDS.ewbGenerate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string;
      invoiceId?: string; dispatchId?: string;
      supplyType: string; subSupplyType: string;
      docType: string; docNo: string; docDate: string;
      fromGstin: string; fromName: string; fromAddr: string; fromPin: string; fromStateCode: string;
      toGstin?: string; toName: string; toAddr: string; toPin: string; toStateCode: string;
      totalValueMinor: number; hsnCode: string;
      transportMode?: string; vehicleNo?: string; transporterId?: string;
    };

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // Insert pending record
      await repo.insertEwayBill(tx, {
        id: p.id,
        tenantId: p.tenantId,
        invoiceId: p.invoiceId ?? null,
        dispatchId: p.dispatchId ?? null,
        supplyType: p.supplyType,
        subSupplyType: p.subSupplyType,
        docType: p.docType,
        docNo: p.docNo,
        docDate: p.docDate,
        fromGstin: p.fromGstin,
        fromName: p.fromName,
        fromAddr: p.fromAddr,
        fromPin: p.fromPin,
        fromStateCode: p.fromStateCode,
        toGstin: p.toGstin ?? null,
        toName: p.toName,
        toAddr: p.toAddr,
        toPin: p.toPin,
        toStateCode: p.toStateCode,
        totalValueMinor: BigInt(p.totalValueMinor),
        hsnCode: p.hsnCode,
        transportMode: p.transportMode ?? null,
        vehicleNo: p.vehicleNo ?? null,
        transporterId: p.transporterId ?? null,
        status: "pending",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      await audit(tx, msg, "create", "eway_bill", p.id);
    });

    // Call NIC API (outside transaction — external call)
    try {
      const totalValueRupees = Number(p.totalValueMinor) / 100;
      const result = await nicClient.generateEwb({
        supplyType: p.supplyType,
        subSupplyType: p.subSupplyType,
        docType: p.docType,
        docNo: p.docNo,
        docDate: p.docDate,
        fromGstin: p.fromGstin,
        fromName: p.fromName,
        fromAddr: p.fromAddr,
        fromPin: p.fromPin,
        fromStateCode: p.fromStateCode,
        toGstin: p.toGstin,
        toName: p.toName,
        toAddr: p.toAddr,
        toPin: p.toPin,
        toStateCode: p.toStateCode,
        totalValue: totalValueRupees,
        hsnCode: p.hsnCode,
        transportMode: p.transportMode,
        vehicleNo: p.vehicleNo,
        transporterId: p.transporterId,
      });

      await db.transaction(async (tx) => {
        await repo.updateEwayBillStatus(tx, p.id, p.tenantId, {
          ewbNo: result.ewbNo,
          validUntil: new Date(result.validUpto),
          status: "active",
          updatedBy: msg.actorId,
          version: 2,
        });
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Unknown NIC API error";
      await db.transaction(async (tx) => {
        await repo.updateEwayBillStatus(tx, p.id, p.tenantId, {
          status: "failed",
          errorMessage,
          updatedBy: msg.actorId,
          version: 2,
        });
      });
    }

    await cache.invalidateResource(msg.tenantId, "eway_bill");
  });

  // --- Cancel e-Way Bill ---
  queue.subscribe(COMMANDS.ewbCancel, async (msg) => {
    const p = msg.payload as { ewayBillId: string; tenantId: string; reason: string };

    const bill = await repo.findById(p.tenantId, p.ewayBillId);
    if (!bill || bill.status !== "active" || !bill.ewbNo) return;

    // Enforce 24h cancellation window
    const createdAt = new Date(bill.createdAt).getTime();
    const now = Date.now();
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    if (now - createdAt > TWENTY_FOUR_HOURS) {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.updateEwayBillStatus(tx, p.ewayBillId, p.tenantId, {
          errorMessage: "Cancellation window expired (>24h)",
          updatedBy: msg.actorId,
        });
      });
      return;
    }

    try {
      await nicClient.cancelEwb(bill.ewbNo, p.reason);

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.updateEwayBillStatus(tx, p.ewayBillId, p.tenantId, {
          status: "cancelled",
          updatedBy: msg.actorId,
          version: bill.version + 1,
        });
        await audit(tx, msg, "cancel", "eway_bill", p.ewayBillId);
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Cancel failed";
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.updateEwayBillStatus(tx, p.ewayBillId, p.tenantId, {
          errorMessage,
          updatedBy: msg.actorId,
        });
      });
    }

    await cache.invalidateResource(msg.tenantId, "eway_bill");
  });

  // --- Update Vehicle (Part-B) ---
  queue.subscribe(COMMANDS.ewbUpdateVehicle, async (msg) => {
    const p = msg.payload as { ewayBillId: string; tenantId: string; vehicleNo: string; transportMode?: string };

    const bill = await repo.findById(p.tenantId, p.ewayBillId);
    if (!bill || bill.status !== "active" || !bill.ewbNo) return;

    try {
      const result = await nicClient.updateVehicle(bill.ewbNo, p.vehicleNo, p.transportMode);

      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.updateEwayBillStatus(tx, p.ewayBillId, p.tenantId, {
          vehicleNo: p.vehicleNo,
          transportMode: p.transportMode ?? bill.transportMode,
          validUntil: new Date(result.validUpto),
          updatedBy: msg.actorId,
          version: bill.version + 1,
        });
        await audit(tx, msg, "update_vehicle", "eway_bill", p.ewayBillId);
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Vehicle update failed";
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.updateEwayBillStatus(tx, p.ewayBillId, p.tenantId, {
          errorMessage,
          updatedBy: msg.actorId,
        });
      });
    }

    await cache.invalidateResource(msg.tenantId, "eway_bill");
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "stock", action, resourceType, resourceId, outcome: "success" },
  });
}
