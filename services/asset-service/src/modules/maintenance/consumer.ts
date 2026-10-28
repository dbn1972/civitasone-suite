import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import * as registerRepo from "../register/repo.js";
import { isUniqueViolation } from "../register/consumer.js";
import { postMaintenanceOrDefer } from "../enterprise/postings.js";

const log = pino({ name: "asset-maintenance-consumer" });
const AUDIT_TOPIC = "audit.event.record";
// No default GL accounts: the maintenance expense / AP control heads are the tenant's asset_settings. If they are not
// configured the work order is still completed and its journal deferred (ASSET_GL_NOT_CONFIGURED) -- enterprise/postings.ts.

export function registerMaintenanceConsumers(rawQueue: Queue): void {
  // #146 regression fix: run every handler inside the message tenant context so
  // NOBYPASSRLS + FORCE RLS accepts consumer writes (telephony PR #152 pattern).
  const queue = tenantScoped(rawQueue);
  queue.subscribe(COMMANDS.maintenancePlan, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; assetId: string; tenantId: string; frequency: string; nextDue?: string; description?: string;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.insertMaintenancePlan(tx, {
          id: p.id, tenantId: p.tenantId, assetId: p.assetId,
          frequency: p.frequency, nextDue: p.nextDue ?? null, lastDone: null,
          description: p.description ?? null, status: "active",
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "create", "maintenance_plan", p.id);
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: COMMANDS.maintenancePlan }, "Consumer processing failed");
    }
  });

  // POST /assets/:id/meter-readings was accepted (202) but nothing consumed COMMANDS.meterReadingRecord, so no
  // reading was ever stored (UAT DB test, asset defect 2). Same shape as the handlers here: inbox dedupe, guarded
  // write and audit event in ONE transaction. A reading for an asset that is not in this tenant is refused (audited
  // as a failure, not retried: a retry could never succeed) instead of being stored against nothing.
  queue.subscribe(COMMANDS.meterReadingRecord, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; assetId: string; tenantId: string; meterType: string; readingValue: number;
        unit?: string; readingDate: string; source?: string; notes?: string;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const asset = await registerRepo.findAssetByIdTx(tx, p.assetId, p.tenantId);
        if (!asset) {
          await enqueue(tx, {
            topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
            tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
            payload: {
              service: "asset", action: "record", resourceType: "meter_reading", resourceId: p.id, outcome: "failure",
              details: { failure: "ASSET_NOT_FOUND", assetId: p.assetId },
            },
          });
          log.warn({ messageId: msg.messageId, assetId: p.assetId }, "meter reading refused: asset not found for tenant");
          return;
        }
        await repo.insertMeterReading(tx, {
          id: p.id, tenantId: p.tenantId, assetId: p.assetId, meterType: p.meterType,
          // numeric(18,4) is carried as text (see schema.ts); String() keeps the decimal exactly as the caller sent it.
          readingValue: String(p.readingValue), unit: p.unit ?? "km", readingDate: p.readingDate,
          source: p.source ?? "manual", notes: p.notes ?? null, createdBy: msg.actorId,
        });
        await audit(tx, msg, "record", "meter_reading", p.id);
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: COMMANDS.meterReadingRecord }, "Consumer processing failed");
    }
  });

  queue.subscribe(COMMANDS.workOrderCreate, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; assetId: string; tenantId: string; planId?: string; scheduledDate: string; notes?: string;
        maintenanceType?: "preventive" | "corrective" | "amc" | "breakdown";
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.insertWorkOrder(tx, {
          id: p.id, tenantId: p.tenantId, assetId: p.assetId,
          planId: p.planId ?? null, scheduledDate: p.scheduledDate,
          completedDate: null, status: "open", costMinor: 0n, currency: "INR",
          notes: p.notes ?? null, maintenanceType: p.maintenanceType ?? "corrective",
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await audit(tx, msg, "create", "work_order", p.id);
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        // GAP-ASSETS-MAINTENANCE-NEW-06: the loser of a race on uq_work_orders_one_open_per_asset_type. The insert's
        // transaction rolled back (so did its inbox row). Record the refusal as an audited FAILURE in a fresh
        // transaction and mark the message processed: a retry could never succeed, so it must not loop.
        const p = msg.payload as { id: string; assetId: string; maintenanceType?: string };
        await db.transaction(async (tx) => {
          if (!(await markProcessed(tx, msg.messageId))) return;
          await enqueue(tx, {
            topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
            tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
            payload: {
              service: "asset", action: "create", resourceType: "work_order", resourceId: p.id, outcome: "failure",
              details: { failure: "DUPLICATE_OPEN_WORK_ORDER", assetId: p.assetId, maintenanceType: p.maintenanceType ?? "corrective" },
            },
          });
        });
        log.warn({ messageId: msg.messageId, assetId: p.assetId }, "duplicate open work order refused");
        return;
      }
      log.error({ err, messageId: msg.messageId, type: COMMANDS.workOrderCreate }, "Consumer processing failed");
    }
  });

  queue.subscribe(COMMANDS.workOrderComplete, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; completedDate: string; costMinor: number; currency: string; notes?: string;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const wo = await repo.findWorkOrderByIdTx(tx, p.id, p.tenantId);
        if (!wo) {
          throw new Error(`WORK_ORDER_NOT_FOUND_OR_CROSS_TENANT: ${p.id} for tenant ${p.tenantId}`);
        }
        const costMinor = BigInt(p.costMinor);
        await repo.completeWorkOrder(tx, p.id, p.tenantId, p.completedDate, costMinor, msg.actorId);
        await postMaintenanceOrDefer(tx, msg, { id: p.id, tenantId: msg.tenantId, assetId: String(wo.assetId), costMinor, completedDate: p.completedDate });
        await audit(tx, msg, "complete", "work_order", p.id);
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: COMMANDS.workOrderComplete }, "Consumer processing failed");
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
