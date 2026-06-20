import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { assertCanAmend } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerContractConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.contractCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; contractNo: string; vendorId: string; poRef?: string;
      title: string; valueMinor: number; currency?: string;
      startDate: string; expiry: string; slaTerms?: Record<string, unknown>;
      milestones?: Array<{ title: string; dueDate: string; amountMinor: number; currency?: string }>;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertContract(tx, {
        id: p.id, tenantId: p.tenantId, contractNo: p.contractNo, vendorId: p.vendorId,
        poRef: p.poRef ?? null, title: p.title, valueMinor: BigInt(p.valueMinor),
        currency: p.currency ?? "INR", startDate: p.startDate, expiry: p.expiry,
        status: "active", slaTerms: p.slaTerms ?? null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      if (p.milestones?.length) {
        const { contractMilestones } = await import("./schema.js");
        const milestoneRows = p.milestones.map((m) => ({
          id: randomUUID(), contractId: p.id, tenantId: p.tenantId,
          title: m.title, dueDate: m.dueDate, amountMinor: BigInt(m.amountMinor),
          currency: m.currency ?? "INR", status: "pending",
          achievedDate: null, createdBy: msg.actorId, updatedBy: msg.actorId,
        }));
        await tx.insert(contractMilestones).values(milestoneRows);
      }
      await enqueue(tx, {
        topic: EVENTS.contractCreated, eventType: EVENTS.contractCreated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { contractId: p.id, vendorId: p.vendorId, valueMinor: p.valueMinor },
      });
      await audit(tx, msg, "create", "contract", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "contract", p.id));
  });

  queue.subscribe(COMMANDS.contractAmend, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; reason: string; valueDelta: number; newExpiry?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const contract = await repo.findContractByIdTx(tx, p.id);
      if (!contract) throw new Error(`contract ${p.id} not found`);
      assertCanAmend(contract.status ?? "draft");
      const amendmentNo = (await repo.countAmendments(tx, p.id)) + 1;
      await repo.insertAmendment(tx, {
        id: randomUUID(), contractId: p.id, tenantId: p.tenantId,
        amendmentNo, reason: p.reason, valueDelta: BigInt(p.valueDelta),
        newExpiry: p.newExpiry ?? null, approvedBy: msg.actorId,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      const patch: Record<string, unknown> = { valueMinor: contract.valueMinor + BigInt(p.valueDelta), updatedBy: msg.actorId, version: (contract.version ?? 1) + 1 };
      if (p.newExpiry) patch["expiry"] = p.newExpiry;
      await repo.updateContract(tx, p.id, patch as any);
      await enqueue(tx, {
        topic: EVENTS.contractAmended, eventType: EVENTS.contractAmended,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { contractId: p.id, amendmentNo, valueDelta: p.valueDelta },
      });
      await audit(tx, msg, "amend", "contract", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "contract", p.id));
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "contract", action, resourceType, resourceId, outcome: "success" },
  });
}
