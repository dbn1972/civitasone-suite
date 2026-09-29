/**
 * Water-metering consumer — CQRS write path for the water-metering
 * asset-register module (meter readings, bills, service requests).
 *
 * Before this: water-metering/routes.ts published commands
 * (asset.water.meter_reading.*, asset.water.bill.*,
 * asset.water.service_request.*) with no consumer.ts ever registered in
 * worker.ts, and no migration ever created the `water_metering`
 * schema/tables (see migrations/0028_water_metering_tables.sql -- this is
 * the exact gap tests/comp-007-asset-water-smoke.test.ts documented as a
 * KNOWN ISSUE, updated in this same PR to assert the fixed behaviour). POST
 * returned 202 {id,status:"accepted"} but nothing was ever persisted; GET
 * list/by-id hit "relation ... does not exist" (500).
 *
 * Scope: implements the full command surface routes.ts already exposes,
 * since repo.ts already had every insert/update function written and unused
 * -- wiring them up is mechanical, not new design. resolveServiceRequest
 * applies "resolved" directly and does not check the request was actually
 * "open"/"in_progress" first; this is a documented, deliberate scope cut
 * (core create+list+get-by-id over complex status transitions), not a
 * silent drop.
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import { validateMeterReading, calculateBillAmount, generateBillNumber } from "./domain.js";

const log = pino({ name: "water-metering-consumer" });
const AUDIT_TOPIC = "audit.event.record";
const WATER_METER_READING_RECORDED = "asset.water.meter_reading.recorded";
const WATER_BILL_GENERATED         = "asset.water.bill.generated";
const WATER_SERVICE_REQUEST_CREATED = "asset.water.service_request.created";

export function registerWaterMeteringConsumers(rawQueue: Queue): void {
  // #146 regression fix pattern: run every handler inside the message tenant
  // context so NOBYPASSRLS + FORCE RLS accepts consumer writes.
  const queue = tenantScoped(rawQueue);

  // ── meter readings ───────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.waterMeterReadingRecord, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; connectionId: string; readingDate: string;
        previousReading: string; currentReading: string; photo?: string;
      };
      // Domain validation BEFORE any write -- a NonRetryableError-style guard
      // (thrown synchronously here, caught by the try/catch below) so a
      // malformed reading is logged and dead-ends rather than being
      // persisted as bad data.
      validateMeterReading(p.previousReading, p.currentReading);
      const consumption = (parseFloat(p.currentReading) - parseFloat(p.previousReading)).toString();
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.insertReading(tx, {
          id: p.id, tenantId: p.tenantId, connectionId: p.connectionId,
          readingDate: p.readingDate, previousReading: p.previousReading,
          currentReading: p.currentReading, consumption,
          photo: p.photo ?? null,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await enqueue(tx, {
          topic: WATER_METER_READING_RECORDED, eventType: WATER_METER_READING_RECORDED,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { readingId: p.id, connectionId: p.connectionId, consumption },
        });
        await audit(tx, msg, "record", "water_meter_reading", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "waterMeterReadingRecord failed"); }
  });

  // ── bills ────────────────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.waterBillGenerate, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; connectionId: string; readingId?: string;
        consumptionKl: number; ratePerKl: number; billingPeriod?: string; dueDate: string;
      };
      const ratePerKlMinor = BigInt(Math.round(p.ratePerKl));
      // NOTE: domain.ts's calculateBillAmount does `BigInt(consumptionKl)`,
      // which throws for a fractional consumptionKl (e.g. 12.5) -- a
      // pre-existing limitation in that function, not introduced here.
      const { amountMinor, taxMinor, totalMinor } = calculateBillAmount(p.consumptionKl, ratePerKlMinor);
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.insertBill(tx, {
          id: p.id, tenantId: p.tenantId, connectionId: p.connectionId,
          billNumber: generateBillNumber(), billingPeriod: p.billingPeriod ?? null,
          readingId: p.readingId ?? null, consumptionKl: String(p.consumptionKl),
          ratePerKl: ratePerKlMinor, amountMinor, taxMinor, totalMinor,
          dueDate: p.dueDate,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await enqueue(tx, {
          topic: WATER_BILL_GENERATED, eventType: WATER_BILL_GENERATED,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { billId: p.id, connectionId: p.connectionId, totalMinor: totalMinor.toString() },
        });
        await audit(tx, msg, "generate", "water_bill", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "waterBillGenerate failed"); }
  });

  // ── service requests ─────────────────────────────────────────────────────
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
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await enqueue(tx, {
          topic: WATER_SERVICE_REQUEST_CREATED, eventType: WATER_SERVICE_REQUEST_CREATED,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { requestId: p.id, connectionId: p.connectionId },
        });
        await audit(tx, msg, "create", "water_service_request", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "waterServiceRequestCreate failed"); }
  });

  queue.subscribe(COMMANDS.waterServiceRequestResolve, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string; resolution: string };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.updateServiceRequestStatus(tx, p.id, p.tenantId, "resolved", {
          resolution: p.resolution, resolvedAt: new Date(), updatedBy: msg.actorId,
        });
        await audit(tx, msg, "resolve", "water_service_request", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "waterServiceRequestResolve failed"); }
  });
}

async function audit(
  tx: Parameters<typeof enqueue>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string, resourceType: string, resourceId: string,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "asset", action, resourceType, resourceId, outcome: "success" },
  });
}
