import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { tenantTransaction } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { runWithTenant } from "@civitasone/db";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { minorString } from "@civitasone/schemas/money";
import { assertValidFY, assertReappropriationValid, assertSanctionApproverDistinct, DomainError } from "./domain.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerBudgetConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);
  // Tenant context: every command carries tenantId in its envelope. Wrap each
  // handler in runWithTenant so the db.transaction() GUC (app.tenant_id) is set
  // and FORCE ROW LEVEL SECURITY writes/reads are scoped to the message tenant.
  const sub = <T>(topic: string, handler: (msg: CommandEnvelope<T>) => Promise<void>): void =>
    queue.subscribe<T>(topic, async (msg) => { await runWithTenant(msg.tenantId, () => handler(msg)); });
  sub(COMMANDS.budgetCreate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; headId: string; fy: string; beMinor: number };
    await tenantTransaction(db, p.tenantId, async (tx) => {
      if (!(await markProcessed(tx as Parameters<typeof markProcessed>[0], msg.messageId))) return;
      assertValidFY(p.fy);
      await repo.insertBudget(tx as Parameters<typeof repo.insertBudget>[0], {
        id: p.id, tenantId: p.tenantId, headId: p.headId, fy: p.fy,
        beMinor: BigInt(p.beMinor), reMinor: BigInt(p.beMinor),
        allocatedMinor: 0n, utilisedMinor: 0n, currency: "INR",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "budget", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "budget", `${(msg.payload as any).headId}:${(msg.payload as any).fy}`));
  });

  sub(COMMANDS.budgetReappropriate, async (msg) => {
    // Zero-sum re-appropriation (GFR Rule 10): move `amountMinor` paise from the
    // source budget's savings (p.fromBudgetId) to the target budget (p.id).
    const p = msg.payload as { id: string; tenantId: string; fromBudgetId: string; amountMinor: number; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const source = await repo.findBudgetByIdTx(tx, p.fromBudgetId);
      if (!source || source.tenantId !== p.tenantId) {
        throw new DomainError("SOURCE_NOT_FOUND", `re-appropriation source budget ${p.fromBudgetId} not found`);
      }
      const amount = BigInt(p.amountMinor);
      // Validate against the source head's savings before touching any row.
      assertReappropriationValid({ reMinor: source.reMinor, utilisedMinor: source.utilisedMinor }, amount);
      const moved = await repo.transferBudgetReMinorGuarded(tx, p.fromBudgetId, p.id, amount, p.tenantId, msg.actorId);
      if (!moved) {
        throw new DomainError("INSUFFICIENT_SAVINGS", `source budget ${p.fromBudgetId} lacks savings for ${amount} paise`);
      }
      await audit(tx, msg, "re_appropriate", "budget", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "budget", p.id));
    await cache.invalidate(cache.makeKey(msg.tenantId, "budget", p.fromBudgetId));
  });

  sub(COMMANDS.sanctionCreate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; sanctionNo: string; purpose: string; headId: string; amountMinor: number; currency?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // R11 (maker-checker): a sanction is created as `pending_approval`. It does
      // NOT self-approve and does NOT emit sanction.approved here — a separate
      // checker (finance.sanction.approve, SoD-guarded) or the eOffice decision
      // loop moves it to `approved` and emits the event. A single officer can no
      // longer raise an already-sanctioned amount.
      await repo.insertSanction(tx, {
        id: p.id, tenantId: p.tenantId, sanctionNo: p.sanctionNo, purpose: p.purpose,
        headId: p.headId, amountMinor: BigInt(p.amountMinor),
        currency: p.currency ?? "INR", status: "pending_approval",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "sanction", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "sanction", p.id));
  });

  sub(COMMANDS.sanctionApprove, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const sanction = await repo.findSanctionByIdTx(tx, p.id);
      if (!sanction || sanction.tenantId !== p.tenantId) return;
      // Only a pending sanction can be approved (idempotent on redelivery).
      if (sanction.status !== "pending_approval" && sanction.status !== "draft") return;
      // R11 SoD: the approving officer (checker) must differ from the creator
      // (maker). Same-officer approval is the maker-checker bypass we are closing.
      assertSanctionApproverDistinct(sanction.createdBy, msg.actorId);
      await repo.updateSanction(tx, p.id, { status: "approved", updatedBy: msg.actorId });
      await enqueue(tx, {
        topic: EVENTS.sanctionApproved, eventType: EVENTS.sanctionApproved,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { sanctionId: p.id, headId: sanction.headId, amountMinor: minorString(sanction.amountMinor) },
      });
      await audit(tx, msg, "approve", "sanction", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "sanction", p.id));
  });

  sub(COMMANDS.sanctionReject, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.updateSanction(tx, p.id, { status: "cancelled", updatedBy: msg.actorId });
      await audit(tx, msg, "reject", "sanction", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "sanction", p.id));
  });

  sub(COMMANDS.sanctionSubmitApproval, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const sanction = await repo.findSanctionByIdTx(tx, p.id);
      if (!sanction || sanction.tenantId !== p.tenantId) return;
      await repo.updateSanction(tx, p.id, { status: "pending_approval", updatedBy: msg.actorId });
      await audit(tx, msg, "submit_for_eoffice_approval", "sanction", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "sanction", p.id));
  });

  sub(COMMANDS.reappropriationSubmitApproval, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; fromBudgetId: string; toBudgetId: string; headId?: string; amountMinor: number; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertReappropriation(tx, {
        id: p.id, tenantId: p.tenantId, budgetId: p.toBudgetId, fromBudgetId: p.fromBudgetId,
        headId: p.headId ?? null,
        amountMinor: BigInt(p.amountMinor), reason: p.reason, status: "pending_approval",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "submit_for_eoffice_approval", "reappropriation", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "reappropriation", p.id));
  });
  // ── F3 CQRS: allocation / distribution / formulation ──────────────────────
  sub(COMMANDS.budgetAllocationUpsert, async (msg) => {
    const { upsertAllocation } = await import("./allocation-repo.js");
    const p = msg.payload as {
      id: string; tenantId: string; headId: string; fy: string; allocatedMinor: number; enforce?: boolean;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await upsertAllocation(tx, {
        id: p.id, tenantId: p.tenantId, headId: p.headId, fy: p.fy,
        allocatedMinor: BigInt(p.allocatedMinor),
        ...(p.enforce !== undefined ? { enforce: p.enforce } : {}),
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "upsert", "budget_allocation", p.id);
    });
  });

  sub(COMMANDS.budgetAllocationReappropriate, async (msg) => {
    const allocRepo = await import("./allocation-repo.js");
    const { DomainError } = await import("./domain.js");
    const p = msg.payload as {
      id: string; tenantId: string; fy: string; fromHeadId: string; toHeadId: string;
      amountMinor: number; reason?: string; toAllocId: string; logId: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const from = await allocRepo.findAllocationTx(tx, p.tenantId, p.fromHeadId, p.fy);
      if (!from) throw new DomainError("NOT_FOUND", "source allocation not found");
      let to = await allocRepo.findAllocationTx(tx, p.tenantId, p.toHeadId, p.fy);
      if (!to) {
        await allocRepo.upsertAllocation(tx, {
          id: p.toAllocId, tenantId: p.tenantId, headId: p.toHeadId, fy: p.fy,
          allocatedMinor: 0n, createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        to = await allocRepo.findAllocationTx(tx, p.tenantId, p.toHeadId, p.fy);
      }
      const moved = await allocRepo.moveAllocationGuarded(tx, from.id, to!.id, BigInt(p.amountMinor));
      if (!moved) throw new DomainError("REAPPROPRIATION_EXCEEDS_BALANCE", "re-appropriation exceeds source available balance");
      await allocRepo.logReappropriation(tx, {
        id: p.logId, tenantId: p.tenantId, fy: p.fy,
        fromHeadId: p.fromHeadId, toHeadId: p.toHeadId,
        amountMinor: BigInt(p.amountMinor),
        ...(p.reason ? { reason: p.reason } : {}),
        createdBy: msg.actorId,
      });
      await audit(tx, msg, "reappropriate", "budget_allocation", p.id);
    });
  });

  sub(COMMANDS.allocationDistributionCreate, async (msg) => {
    const repo = await import("./distribution-repo.js");
    const { assertWithinAllocation } = await import("./distribution-domain.js");
    const { DomainError } = await import("./domain.js");
    const p = msg.payload as {
      id: string; tenantId: string; allocationId: string; fromOfficeId: string; toOfficeId: string;
      amountMinor: number; currency: string; conditions?: string | null; effectiveFrom?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const alloc = await repo.lockAllocationByIdTx(tx, p.allocationId, p.tenantId);
      if (!alloc) throw new DomainError("NOT_FOUND", "parent allocation not found");
      const distributed = await repo.sumDistributedTx(tx, p.allocationId, p.tenantId);
      assertWithinAllocation(alloc.allocatedMinor, distributed, BigInt(p.amountMinor));
      await repo.insertDistribution(tx, {
        id: p.id, tenantId: p.tenantId, allocationId: p.allocationId, fy: alloc.fy, headId: alloc.headId,
        fromOfficeId: p.fromOfficeId, toOfficeId: p.toOfficeId, amountMinor: BigInt(p.amountMinor),
        currency: p.currency, conditions: p.conditions ?? null, status: "draft",
        effectiveFrom: p.effectiveFrom ?? new Date().toISOString().slice(0, 10),
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "allocation_distribution", p.id);
    });
  });

  sub(COMMANDS.allocationDistributionIssue, async (msg) => {
    const repo = await import("./distribution-repo.js");
    const { assertDistributionTransition } = await import("./distribution-domain.js");
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await repo.findDistributionByIdTx(tx, p.id, p.tenantId);
      if (!row) return;
      assertDistributionTransition(row.status as any, "issued");
      await repo.updateDistribution(tx, p.id, { status: "issued", issuedBy: msg.actorId, issuedAt: new Date(), updatedBy: msg.actorId });
      await enqueue(tx, {
        topic: EVENTS.allocationDistributed, eventType: EVENTS.allocationDistributed,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          distributionId: p.id, allocationId: row.allocationId, headId: row.headId, fy: row.fy,
          toOfficeId: row.toOfficeId, amountMinor: row.amountMinor.toString(),
          effectiveFrom: row.effectiveFrom,
        },
      });
      await audit(tx, msg, "issue", "allocation_distribution", p.id);
    });
  });

  sub(COMMANDS.allocationDistributionAcknowledge, async (msg) => {
    const repo = await import("./distribution-repo.js");
    const { assertDistributionTransition, assertAcknowledgerDistinct } = await import("./distribution-domain.js");
    const p = msg.payload as { id: string; tenantId: string; note?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await repo.findDistributionByIdTx(tx, p.id, p.tenantId);
      if (!row) return;
      assertDistributionTransition(row.status as any, "acknowledged");
      assertAcknowledgerDistinct(row.issuedBy ?? row.createdBy, msg.actorId);
      await repo.updateDistribution(tx, p.id, {
        status: "acknowledged", acknowledgedBy: msg.actorId, acknowledgedAt: new Date(),
        acknowledgeNote: p.note ?? null, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "acknowledge", "allocation_distribution", p.id);
    });
  });

  sub(COMMANDS.budgetProposalCreate, async (msg) => {
    const repo = await import("./formulation-repo.js");
    const p = msg.payload as {
      id: string; tenantId: string; fy: string; deptCode: string; headId: string;
      ceilingMinor: number; proposedMinor: number; currency: string; justification: string; effectiveFrom?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertProposal(tx, {
        id: p.id, tenantId: p.tenantId, fy: p.fy, deptCode: p.deptCode, headId: p.headId,
        ceilingMinor: BigInt(p.ceilingMinor), proposedMinor: BigInt(p.proposedMinor),
        currency: p.currency, justification: p.justification, status: "draft",
        effectiveFrom: p.effectiveFrom ?? new Date().toISOString().slice(0, 10),
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "budget_proposal", p.id);
    });
  });

  sub(COMMANDS.budgetProposalSubmit, async (msg) => {
    const repo = await import("./formulation-repo.js");
    const { assertProposalTransition } = await import("./formulation-domain.js");
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await repo.findProposalByIdTx(tx, p.id, p.tenantId);
      if (!row) return;
      assertProposalTransition(row.status as any, "submitted");
      await repo.updateProposal(tx, p.id, { status: "submitted", updatedBy: msg.actorId });
      await audit(tx, msg, "transition_submitted", "budget_proposal", p.id);
    });
  });

  sub(COMMANDS.budgetProposalReview, async (msg) => {
    const repo = await import("./formulation-repo.js");
    const { assertProposalTransition } = await import("./formulation-domain.js");
    const p = msg.payload as { id: string; tenantId: string; decision: "accept" | "return"; note?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const to = p.decision === "accept" ? "under_review" : "returned";
      const row = await repo.findProposalByIdTx(tx, p.id, p.tenantId);
      if (!row) return;
      assertProposalTransition(row.status as any, to as any);
      await repo.updateProposal(tx, p.id, {
        status: to, reviewNote: p.note ?? null, reviewedBy: msg.actorId, reviewedAt: new Date(), updatedBy: msg.actorId,
      } as any);
      await audit(tx, msg, `transition_${to}`, "budget_proposal", p.id);
    });
  });

  sub(COMMANDS.budgetProposalRevise, async (msg) => {
    const repo = await import("./formulation-repo.js");
    const { nextVersion } = await import("./formulation-domain.js");
    const p = msg.payload as {
      id: string; tenantId: string; parentId: string; proposedMinor: number;
      ceilingMinor?: number; justification: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const parent = await repo.findProposalByIdTx(tx, p.parentId, p.tenantId);
      if (!parent) return;
      const ceiling = p.ceilingMinor !== undefined ? BigInt(p.ceilingMinor) : parent.ceilingMinor;
      await repo.insertProposal(tx, {
        id: p.id, tenantId: p.tenantId, fy: parent.fy, deptCode: parent.deptCode, headId: parent.headId,
        ceilingMinor: ceiling, proposedMinor: BigInt(p.proposedMinor), currency: parent.currency,
        justification: p.justification, status: "draft", parentId: parent.id,
        effectiveFrom: parent.effectiveFrom, version: nextVersion(parent.version),
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "revise", "budget_proposal", p.id);
    });
  });

  sub(COMMANDS.budgetProposalApprove, async (msg) => {
    const repo = await import("./formulation-repo.js");
    const { assertProposalTransition, assertProposalApproverDistinct } = await import("./formulation-domain.js");
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await repo.findProposalByIdTx(tx, p.id, p.tenantId);
      if (!row) return;
      assertProposalTransition(row.status as any, "approved");
      assertProposalApproverDistinct(row.createdBy, msg.actorId);
      await repo.updateProposal(tx, p.id, {
        status: "approved", approvedBy: msg.actorId, approvedAt: new Date(), updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.proposalApproved, eventType: EVENTS.proposalApproved,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          proposalId: p.id, headId: row.headId, fy: row.fy, deptCode: row.deptCode,
          proposedMinor: row.proposedMinor.toString(),
        },
      });
      await audit(tx, msg, "approve", "budget_proposal", p.id);
    });
  });

  // ── F3 CQRS residuals: outcome / supplementary ────────────────────────────
  sub(COMMANDS.budgetOutcomeCreate, async (msg) => {
    const outcomeRepo = await import("./outcome-repo.js");
    const p = msg.payload as {
      id: string; tenantId: string; headId: string; fy: string;
      allocationId: string | null; schemeId: string | null;
      outputDesc: string; outcomeDesc: string; indicator: string; unit: string;
      baselineValue: number; targetValue: number; allocatedMinor: number;
      currency: string; effectiveFrom: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await outcomeRepo.insertOutcome(tx, {
        id: p.id, tenantId: p.tenantId, headId: p.headId, fy: p.fy,
        allocationId: p.allocationId, schemeId: p.schemeId,
        outputDesc: p.outputDesc, outcomeDesc: p.outcomeDesc,
        indicator: p.indicator, unit: p.unit,
        baselineValue: BigInt(p.baselineValue), targetValue: BigInt(p.targetValue),
        achievedValue: 0n, allocatedMinor: BigInt(p.allocatedMinor),
        currency: p.currency, status: "active",
        effectiveFrom: p.effectiveFrom,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "budget_outcome", p.id);
    });
  });

  sub(COMMANDS.budgetOutcomeAchievement, async (msg) => {
    const outcomeRepo = await import("./outcome-repo.js");
    const { DomainError } = await import("./domain.js");
    const p = msg.payload as { id: string; tenantId: string; achievedValue: number };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await outcomeRepo.findOutcomeByIdTx(tx, p.id, p.tenantId);
      if (!row) throw new DomainError("NOT_FOUND", "outcome not found");
      if (row.status === "evaluated" || row.status === "closed") {
        throw new DomainError("OUTCOME_ALREADY_EVALUATED", `achievement is locked once the outcome is ${row.status}`);
      }
      await outcomeRepo.updateOutcome(tx, p.id, {
        achievedValue: BigInt(p.achievedValue), updatedBy: msg.actorId,
      });
      await audit(tx, msg, "record_achievement", "budget_outcome", p.id);
    });
  });

  sub(COMMANDS.budgetOutcomeEvaluate, async (msg) => {
    const outcomeRepo = await import("./outcome-repo.js");
    const { assertEvaluatorDistinct, classifyAchievement } = await import("./outcome-domain.js");
    const p = msg.payload as { id: string; tenantId: string; note: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await outcomeRepo.findOutcomeByIdTx(tx, p.id, p.tenantId);
      if (!row) return;
      assertEvaluatorDistinct(row.createdBy, msg.actorId);
      const rating = classifyAchievement(
        { targetValue: row.targetValue, baselineValue: row.baselineValue },
        row.achievedValue,
      );
      await outcomeRepo.updateOutcome(tx, p.id, {
        status: "evaluated", evaluationRating: rating, evaluationNote: p.note,
        evaluatedBy: msg.actorId, evaluatedAt: new Date(), updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.outcomeEvaluated, eventType: EVENTS.outcomeEvaluated,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          outcomeId: p.id, headId: row.headId, fy: row.fy, rating,
          achievedValue: row.achievedValue.toString(), targetValue: row.targetValue.toString(),
        },
      });
      await audit(tx, msg, "evaluate", "budget_outcome", p.id);
    });
  });

  sub(COMMANDS.supplementaryCreate, async (msg) => {
    const suppRepo = await import("./supplementary-repo.js");
    const p = msg.payload as {
      id: string; tenantId: string; fy: string; budgetId: string; headId: string;
      amountMinor: number; limitMinor: number; currency: string; kind: string;
      authority: string; reason: string; effectiveFrom: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await suppRepo.insertSupplementary(tx, {
        id: p.id, tenantId: p.tenantId, fy: p.fy, budgetId: p.budgetId, headId: p.headId,
        amountMinor: BigInt(p.amountMinor), limitMinor: BigInt(p.limitMinor),
        currency: p.currency, kind: p.kind, authority: p.authority, reason: p.reason,
        status: "pending_approval", effectiveFrom: p.effectiveFrom,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "supplementary_demand", p.id);
    });
  });

  sub(COMMANDS.supplementaryApprove, async (msg) => {
    const suppRepo = await import("./supplementary-repo.js");
    const budgetRepo = await import("./repo.js");
    const {
      assertSupplementaryTransition, assertSupplementaryApproverDistinct,
    } = await import("./supplementary-domain.js");
    const { DomainError } = await import("./domain.js");
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await suppRepo.findSupplementaryByIdTx(tx, p.id, p.tenantId);
      if (!row) return;
      assertSupplementaryTransition(row.status as any, "approved");
      assertSupplementaryApproverDistinct(row.createdBy, msg.actorId);
      const budget = await budgetRepo.findBudgetByIdTx(tx, row.budgetId);
      if (!budget || budget.tenantId !== p.tenantId) {
        throw new DomainError("NOT_FOUND", "target budget not found");
      }
      const applied = await suppRepo.applySupplementaryToBudget(tx as any, row.budgetId, p.tenantId, row.amountMinor, msg.actorId);
      if (!applied) throw new DomainError("APPLY_FAILED", "could not apply supplementary to budget");
      await suppRepo.updateSupplementary(tx, p.id, {
        status: "approved", approvedBy: msg.actorId, approvedAt: new Date(), updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.supplementaryApproved, eventType: EVENTS.supplementaryApproved,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          supplementaryId: p.id, budgetId: row.budgetId, headId: row.headId, fy: row.fy,
          amountMinor: row.amountMinor.toString(), kind: row.kind, authority: row.authority,
        },
      });
      await audit(tx, msg, "approve", "supplementary_demand", p.id);
    });
  });

  sub(COMMANDS.supplementaryReject, async (msg) => {
    const suppRepo = await import("./supplementary-repo.js");
    const { assertSupplementaryTransition } = await import("./supplementary-domain.js");
    const p = msg.payload as { id: string; tenantId: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await suppRepo.findSupplementaryByIdTx(tx, p.id, p.tenantId);
      if (!row) return;
      assertSupplementaryTransition(row.status as any, "rejected");
      await suppRepo.updateSupplementary(tx, p.id, {
        status: "rejected", rejectReason: p.reason, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "reject", "supplementary_demand", p.id);
    });
  });


}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "finance", action, resourceType, resourceId, outcome: "success" },
  });
}
