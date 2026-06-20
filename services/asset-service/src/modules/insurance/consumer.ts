import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerInsuranceConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.insurancePolicyCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; assetId: string; policyNo: string; insurer: string;
      coverageMinor: number; premiumMinor: number; currency: string;
      startDate: string; endDate: string; renewalReminderDays: number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertPolicy(tx, {
        id: p.id, tenantId: p.tenantId, assetId: p.assetId,
        policyNo: p.policyNo, insurer: p.insurer,
        coverageMinor: BigInt(p.coverageMinor), premiumMinor: BigInt(p.premiumMinor),
        currency: p.currency, startDate: p.startDate, endDate: p.endDate,
        renewalReminderDays: p.renewalReminderDays, status: "active",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "insurance_policy", p.id);
    });
  });

  queue.subscribe(COMMANDS.insuranceClaimCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; policyId: string; assetId: string;
      claimDate: string; claimAmountMinor: number; currency: string; notes?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertClaim(tx, {
        id: p.id, tenantId: p.tenantId, policyId: p.policyId, assetId: p.assetId,
        claimDate: p.claimDate, claimAmountMinor: BigInt(p.claimAmountMinor),
        currency: p.currency, status: "pending", settledAmountMinor: 0n,
        notes: p.notes ?? null, createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "insurance_claim", p.id);
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
