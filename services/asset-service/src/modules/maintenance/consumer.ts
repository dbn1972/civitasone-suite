import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { uuidV5 } from "../../shared/ids.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";
const GL_TOPIC = "finance.gl.post";
// 4-digit finance head CODES (resolved by finance via findHeadByCodeTx).
const MAINTENANCE_EXPENSE_CODE = process.env.ASSET_MAINTENANCE_EXPENSE_CODE ?? "5300";
const AP_CONTROL_CODE = process.env.ASSET_AP_CONTROL_CODE ?? "2050";

export function registerMaintenanceConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.maintenancePlan, async (msg) => {
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
  });

  queue.subscribe(COMMANDS.workOrderCreate, async (msg) => {
    const p = msg.payload as {
      id: string; assetId: string; tenantId: string; planId?: string; scheduledDate: string; notes?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertWorkOrder(tx, {
        id: p.id, tenantId: p.tenantId, assetId: p.assetId,
        planId: p.planId ?? null, scheduledDate: p.scheduledDate,
        completedDate: null, status: "open", costMinor: 0n, currency: "INR",
        notes: p.notes ?? null, createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "work_order", p.id);
    });
  });

  queue.subscribe(COMMANDS.workOrderComplete, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; completedDate: string; costMinor: number; currency: string; notes?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // P1-4: tenant-scoped load + hard fail. completeWorkOrder's UPDATE silently
      // affects 0 rows for a missing or cross-tenant work order, so the old code
      // "succeeded" and posted nothing while crossing the tenant boundary. Load
      // under the tenant guard and reject loudly so the message dead-letters
      // instead of silently no-op'ing.
      const wo = await repo.findWorkOrderById(p.id, p.tenantId);
      if (!wo) {
        throw new Error(`WORK_ORDER_NOT_FOUND_OR_CROSS_TENANT: ${p.id} for tenant ${p.tenantId}`);
      }
      const costMinor = BigInt(p.costMinor);
      await repo.completeWorkOrder(tx, p.id, p.tenantId, p.completedDate, costMinor, msg.actorId);
      // P1-3: post a balanced maintenance-expense StandardJournal Dr Repairs &
      // Maintenance Expense (5300) / Cr Accounts Payable (2050). Skip a zero-cost
      // WO so finance never sees a zero-total journal. Deterministic id keyed off
      // the WO so a redelivered completion no-ops in finance instead of
      // double-posting.
      if (costMinor > 0n) {
        await enqueue(tx, {
          topic: GL_TOPIC, eventType: GL_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: {
            // uuidV5 so finance's uuid journal id column accepts it; keyed off
            // the work-order id so a redelivered completion dedupes on the PK.
            id: uuidV5(`maintenance:${p.id}`),
            tenantId: msg.tenantId,
            type: "asset_maintenance",
            voucherNo: `MNT/${p.completedDate}/${String(wo.assetId).slice(0, 8)}`,
            postingDate: p.completedDate,
            lines: [
              { accountCode: MAINTENANCE_EXPENSE_CODE, debitMinor: costMinor.toString(), creditMinor: "0" },
              { accountCode: AP_CONTROL_CODE, debitMinor: "0", creditMinor: costMinor.toString() },
            ],
          },
        });
      }
      await audit(tx, msg, "complete", "work_order", p.id);
    });
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "asset", action, resourceType, resourceId, outcome: "success" },
  });
}
