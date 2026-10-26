import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import * as contractsRepo from "../contracts/repo.js";
import { daysUntil, isMilestone, SYSTEM_ACTOR_ID } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";

/**
 * contract.expiry.check -> contract.expiry.alert.
 *
 * markProcessed + re-validation + alert + audit run in ONE transaction. The
 * contract is re-read under RLS (the tenant comes from the message envelope),
 * so a stale command (contract amended/closed since the sweep, or another
 * tenant's contract) emits nothing.
 */
export function registerExpiryConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.contractExpiryCheck, async (msg) => {
    const p = msg.payload as { contractId: string; expiry: string; milestoneDays: number };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const contract = await contractsRepo.findContractByIdTx(tx, p.contractId);
      if (!contract || contract.status !== "active" || contract.expiry !== p.expiry) return;
      if (!isMilestone(p.milestoneDays)) return;
      const today = new Date().toISOString().slice(0, 10);
      const daysRemaining = daysUntil(contract.expiry, today);
      if (daysRemaining < 0 || daysRemaining > p.milestoneDays) return;
      const actorId = msg.actorId ?? SYSTEM_ACTOR_ID;
      await enqueue(tx, {
        topic: EVENTS.contractExpiryAlert, eventType: EVENTS.contractExpiryAlert,
        tenantId: msg.tenantId, actorId, correlationId: msg.correlationId,
        payload: {
          contractId: contract.id, contractNo: contract.contractNo, title: contract.title,
          vendorId: contract.vendorId, endDate: contract.expiry, daysRemaining,
          milestoneDays: p.milestoneDays,
        },
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId, correlationId: msg.correlationId,
        payload: {
          service: "contract", action: "expiry_alert", resourceType: "contract",
          resourceId: contract.id, outcome: "success", milestoneDays: p.milestoneDays,
        },
      });
    });
  });
}
