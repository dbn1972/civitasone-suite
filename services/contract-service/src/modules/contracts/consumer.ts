import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { assertCanAmend, assertTransitionAllowed, assertDistinctMakerChecker } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerContractConsumers(queue: Queue): void {
  // ── create → draft ──────────────────────────────────────────────────────
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
        status: "draft", slaTerms: p.slaTerms ?? null,
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
        payload: { contractId: p.id, vendorId: p.vendorId, valueMinor: p.valueMinor, status: "draft" },
      });
      await audit(tx, msg, "create", "contract", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "contract", p.id));
  });

  // ── approve: draft → approved (checker, SoD) ─────────────────────────────
  queue.subscribe(COMMANDS.contractApprove, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const contract = await repo.findContractByIdTx(tx, p.id);
      if (!contract) throw new Error(`contract ${p.id} not found`);
      assertDistinctMakerChecker(contract.createdBy, msg.actorId); // defense-in-depth
      assertTransitionAllowed(contract.status ?? "draft", "approved");
      await repo.updateContract(tx, p.id, {
        status: "approved", updatedBy: msg.actorId, version: (contract.version ?? 1) + 1,
      });
      await enqueue(tx, {
        topic: EVENTS.contractApproved, eventType: EVENTS.contractApproved,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { contractId: p.id, approvedBy: msg.actorId },
      });
      await audit(tx, msg, "approve", "contract", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "contract", p.id));
  });

  // ── activate: approved → active ──────────────────────────────────────────
  queue.subscribe(COMMANDS.contractActivate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const contract = await repo.findContractByIdTx(tx, p.id);
      if (!contract) throw new Error(`contract ${p.id} not found`);
      assertTransitionAllowed(contract.status ?? "draft", "active");
      await repo.updateContract(tx, p.id, {
        status: "active", updatedBy: msg.actorId, version: (contract.version ?? 1) + 1,
      });
      await enqueue(tx, {
        topic: EVENTS.contractActivated, eventType: EVENTS.contractActivated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { contractId: p.id },
      });
      await audit(tx, msg, "activate", "contract", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "contract", p.id));
  });

  // ── close: active → closed ───────────────────────────────────────────────
  queue.subscribe(COMMANDS.contractClose, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const contract = await repo.findContractByIdTx(tx, p.id);
      if (!contract) throw new Error(`contract ${p.id} not found`);
      assertTransitionAllowed(contract.status ?? "draft", "closed");
      await repo.updateContract(tx, p.id, {
        status: "closed", updatedBy: msg.actorId, version: (contract.version ?? 1) + 1,
      });
      await enqueue(tx, {
        topic: EVENTS.contractClosed, eventType: EVENTS.contractClosed,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { contractId: p.id },
      });
      await audit(tx, msg, "close", "contract", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "contract", p.id));
  });

  // ── terminate: draft|approved|active → terminated (checker, SoD) ─────────
  queue.subscribe(COMMANDS.contractTerminate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const contract = await repo.findContractByIdTx(tx, p.id);
      if (!contract) throw new Error(`contract ${p.id} not found`);
      assertDistinctMakerChecker(contract.createdBy, msg.actorId); // defense-in-depth
      assertTransitionAllowed(contract.status ?? "draft", "terminated");
      await repo.updateContract(tx, p.id, {
        status: "terminated", updatedBy: msg.actorId, version: (contract.version ?? 1) + 1,
      });
      await enqueue(tx, {
        topic: EVENTS.contractTerminated, eventType: EVENTS.contractTerminated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { contractId: p.id, reason: p.reason, terminatedBy: msg.actorId },
      });
      await audit(tx, msg, "terminate", "contract", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "contract", p.id));
  });

  // ── amend: value/expiry variation (only when active) ─────────────────────
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
      const patch: Record<string, unknown> = {
        valueMinor: contract.valueMinor + BigInt(p.valueDelta),
        updatedBy: msg.actorId, version: (contract.version ?? 1) + 1,
      };
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
