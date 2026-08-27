import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { assertCanAmend, assertTransitionAllowed, assertDistinctMakerChecker, computeMilestonePenalty, assertBondTransition } from "./domain.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerContractConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);
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
    await cache.invalidateResource(msg.tenantId, "contract");
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
    await cache.invalidateResource(msg.tenantId, "contract");
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
    await cache.invalidateResource(msg.tenantId, "contract");
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
    await cache.invalidateResource(msg.tenantId, "contract");
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
    await cache.invalidateResource(msg.tenantId, "contract");
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
    await cache.invalidateResource(msg.tenantId, "contract");
  });

  // ── submit for eOffice award approval: draft → pending_approval ──────────
  queue.subscribe(COMMANDS.contractSubmitApproval, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const contract = await repo.findContractByIdTx(tx, p.id);
      if (!contract || contract.tenantId !== p.tenantId) return;
      // Only a draft contract can be submitted to eOffice for award approval.
      assertTransitionAllowed(contract.status ?? "draft", "pending_approval");
      await repo.updateContract(tx, p.id, {
        status: "pending_approval", updatedBy: msg.actorId, version: (contract.version ?? 1) + 1,
      });
      await audit(tx, msg, "submit_for_eoffice_approval", "contract", p.id);
    });
    await cache.invalidateResource(msg.tenantId, "contract");
  });

  // ── milestone complete (on-time) ─────────────────────────────────────────
  queue.subscribe(COMMANDS.milestoneComplete, async (msg) => {
    const p = msg.payload as { contractId: string; milestoneId: string; tenantId: string; achievedDate: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const contract = await repo.findContractByIdTx(tx, p.contractId);
      if (!contract || contract.tenantId !== p.tenantId) throw new Error(`contract ${p.contractId} not found`);
      const milestone = await repo.findMilestoneByIdTx(tx, p.milestoneId, p.contractId, p.tenantId);
      if (!milestone) throw new Error(`milestone ${p.milestoneId} not found`);
      if (milestone.status === "completed" || milestone.status === "completed_late") return;
      await repo.updateMilestone(tx, p.milestoneId, p.tenantId, {
        status: "completed",
        achievedDate: p.achievedDate,
        penaltyMinor: 0n,
        netPayableMinor: milestone.amountMinor,
        updatedBy: msg.actorId,
        version: (milestone.version ?? 1) + 1,
      });
      await enqueue(tx, {
        topic: EVENTS.milestoneCompleted, eventType: EVENTS.milestoneCompleted,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          contractId: p.contractId, milestoneId: p.milestoneId, status: "completed",
          achievedDate: p.achievedDate, penaltyMinor: "0", netPayableMinor: milestone.amountMinor.toString(),
        },
      });
      await audit(tx, msg, "milestone_complete", "milestone", p.milestoneId);
    });
    await cache.invalidateResource(msg.tenantId, "contract");
  });

  // ── milestone mark late (SLA penalty, bigint paise) ──────────────────────
  queue.subscribe(COMMANDS.milestoneMarkLate, async (msg) => {
    const p = msg.payload as {
      contractId: string; milestoneId: string; tenantId: string; achievedDate: string; notes?: string | null;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const contract = await repo.findContractByIdTx(tx, p.contractId);
      if (!contract || contract.tenantId !== p.tenantId) throw new Error(`contract ${p.contractId} not found`);
      const milestone = await repo.findMilestoneByIdTx(tx, p.milestoneId, p.contractId, p.tenantId);
      if (!milestone) throw new Error(`milestone ${p.milestoneId} not found`);
      if (milestone.status === "completed" || milestone.status === "completed_late") return;

      const sla = (contract.slaTerms ?? {}) as Record<string, unknown>;
      const penaltyRatePct = typeof sla["penaltyRatePct"] === "number" ? sla["penaltyRatePct"] : 0.5;
      const maxPenaltyPct = typeof sla["maxPenaltyPct"] === "number" ? sla["maxPenaltyPct"] : 10;
      const result = computeMilestonePenalty({
        amountMinor: milestone.amountMinor,
        dueDate: milestone.dueDate,
        achievedDate: p.achievedDate,
        penaltyRatePct,
        maxPenaltyPct,
      });

      await repo.updateMilestone(tx, p.milestoneId, p.tenantId, {
        status: result.status,
        achievedDate: p.achievedDate,
        penaltyMinor: result.penaltyMinor,
        netPayableMinor: result.netPayableMinor,
        updatedBy: msg.actorId,
        version: (milestone.version ?? 1) + 1,
      });
      await enqueue(tx, {
        topic: EVENTS.milestoneCompleted, eventType: EVENTS.milestoneCompleted,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          contractId: p.contractId, milestoneId: p.milestoneId, status: result.status,
          achievedDate: p.achievedDate, delayDays: result.delayDays, delayWeeks: result.delayWeeks,
          penaltyMinor: result.penaltyMinor.toString(), netPayableMinor: result.netPayableMinor.toString(),
          notes: p.notes ?? null,
        },
      });
      await audit(tx, msg, "milestone_mark_late", "milestone", p.milestoneId);
    });
    await cache.invalidateResource(msg.tenantId, "contract");
  });

  // ── performance bond register ────────────────────────────────────────────
  queue.subscribe(COMMANDS.bondRegister, async (msg) => {
    const p = msg.payload as {
      id: string; contractId: string; tenantId: string; bondType: string; amountMinor: number;
      currency?: string; issuer: string; referenceNo: string; validFrom: string; validTo: string; notes?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const contract = await repo.findContractByIdTx(tx, p.contractId);
      if (!contract || contract.tenantId !== p.tenantId) throw new Error(`contract ${p.contractId} not found`);
      await repo.insertBond(tx, {
        id: p.id, contractId: p.contractId, tenantId: p.tenantId,
        bondType: p.bondType, amountMinor: BigInt(p.amountMinor), currency: p.currency ?? "INR",
        issuer: p.issuer, referenceNo: p.referenceNo, validFrom: p.validFrom, validTo: p.validTo,
        status: "held", notes: p.notes ?? null, createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.bondRegistered, eventType: EVENTS.bondRegistered,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { bondId: p.id, contractId: p.contractId, amountMinor: p.amountMinor, bondType: p.bondType },
      });
      await audit(tx, msg, "bond_register", "performance_bond", p.id);
    });
    await cache.invalidateResource(msg.tenantId, "contract");
  });

  // ── performance bond transition ──────────────────────────────────────────
  queue.subscribe(COMMANDS.bondTransition, async (msg) => {
    const p = msg.payload as {
      contractId: string; bondId: string; tenantId: string; toStatus: "released" | "claimed" | "forfeited"; notes?: string | null;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const bond = await repo.findBondByIdTx(tx, p.bondId, p.tenantId);
      if (!bond || bond.contractId !== p.contractId) throw new Error(`bond ${p.bondId} not found`);
      assertBondTransition(bond.status ?? "held", p.toStatus);
      await repo.updateBond(tx, p.bondId, p.tenantId, {
        status: p.toStatus,
        notes: p.notes ?? bond.notes,
        updatedBy: msg.actorId,
        version: (bond.version ?? 1) + 1,
      });
      await enqueue(tx, {
        topic: EVENTS.bondTransitioned, eventType: EVENTS.bondTransitioned,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { bondId: p.bondId, contractId: p.contractId, from: bond.status, to: p.toStatus },
      });
      await audit(tx, msg, "bond_transition", "performance_bond", p.bondId);
    });
    await cache.invalidateResource(msg.tenantId, "contract");
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "contract", action, resourceType, resourceId, outcome: "success" },
  });
}
