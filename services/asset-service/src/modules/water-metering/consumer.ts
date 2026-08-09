import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import { validateMeterReading, calculateBillAmount, generateBillNumber } from "./domain.js";

const log = pino({ name: "asset-water-metering-consumer" });
const AUDIT_TOPIC = "audit.event.record";

export function registerWaterMeteringConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.waterMeterReadingRecord, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; connectionId: string; readingDate: string;
        previousReading: string; currentReading: string; photo?: string;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        validateMeterReading(p.previousReading, p.currentReading);
        const consumption = String(parseFloat(p.currentReading) - parseFloat(p.previousReading));
        await repo.insertReading(tx, {
          id: p.id, tenantId: p.tenantId, connectionId: p.connectionId,
          readingDate: p.readingDate, previousReading: p.previousReading,
          currentReading: p.currentReading, consumption, unit: "kl",
          readerId: msg.actorId, photo: p.photo ?? null, status: "pending",
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "record", "water_meter_reading", p.id);
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "Consumer processing failed");
    }
  });

  queue.subscribe(COMMANDS.waterBillGenerate, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; connectionId: string; readingId: string;
        consumptionKl: number; ratePerKl: number; billingPeriod: string; dueDate: string;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const ratePerKlMinor = BigInt(p.ratePerKl);
        const { amountMinor, taxMinor, totalMinor } = calculateBillAmount(p.consumptionKl, ratePerKlMinor);
        await repo.insertBill(tx, {
          id: p.id, tenantId: p.tenantId, connectionId: p.connectionId,
          billNumber: generateBillNumber(), billingPeriod: p.billingPeriod,
          readingId: p.readingId, consumptionKl: String(p.consumptionKl),
          ratePerKl: ratePerKlMinor, amountMinor, currency: "INR",
          taxMinor, totalMinor, dueDate: p.dueDate, status: "generated",
          paymentDate: null, paymentRef: null,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "generate", "water_bill", p.id);
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "Consumer processing failed");
    }
  });

  queue.subscribe(COMMANDS.waterServiceRequestCreate, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; connectionId: string; requestType: string; description?: string;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.insertServiceRequest(tx, {
          id: p.id, tenantId: p.tenantId, connectionId: p.connectionId,
          requestType: p.requestType, description: p.description ?? null,
          status: "open", assignedTo: null, resolvedAt: null,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "create", "water_service_request", p.id);
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "Consumer processing failed");
    }
  });

  queue.subscribe(COMMANDS.waterServiceRequestResolve, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string; resolution: string };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.updateServiceRequestStatus(tx, p.id, p.tenantId, "resolved", {
          resolvedAt: new Date(), updatedBy: msg.actorId,
        });
        await audit(tx, msg, "resolve", "water_service_request", p.id);
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "Consumer processing failed");
    }
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "asset", action, resourceType, resourceId, outcome: "success" },
  });
}
