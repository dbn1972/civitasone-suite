import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, SERVICE } from "../../topics.js";
import { rateHeads, rateSlabs, penaltyRules, rebateRules, configProposals } from "../rate-engine/schema.js";
import { DomainError, assertMakerChecker } from "../rate-engine/domain.js";
import { istToday } from "../arrears/recovery-notice.js";
import { loadConfigStateTx } from "./repo.js";
import { planProposal, type PlanOp, type PlanTable, type Proposal } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";

const TABLES = {
  rate_heads: rateHeads,
  rate_slabs: rateSlabs,
  penalty_rules: penaltyRules,
  rebate_rules: rebateRules,
} as const satisfies Record<PlanTable, unknown>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

/**
 * Execute planned writes. An UPDATE only sets the planned columns (end-date /
 * deactivate): the old row's value and version are never rewritten — an edit is
 * an end-date plus a NEW row. Returns the id of the first inserted row.
 */
async function executeOps(tx: Tx, tenantId: string, actorId: string, ops: PlanOp[]): Promise<string | null> {
  let applied: string | null = null;
  for (const o of ops) {
    const table = TABLES[o.table];
    if (o.op === "insert") {
      const id = randomUUID();
      await tx.insert(table).values({ ...o.values, id, tenantId, createdBy: actorId, updatedBy: actorId });
      applied ??= id;
    } else {
      await tx
        .update(table)
        .set({ ...o.values, updatedBy: actorId, updatedAt: new Date() })
        .where(and(eq(table.tenantId, tenantId), eq(table.id, o.id as string)));
    }
  }
  return applied;
}

async function invalidate(tenantId: string, rateHeadId: string | null): Promise<void> {
  await cache.invalidate(`${SERVICE}:${tenantId}:rate_heads`);
  if (rateHeadId) {
    await cache.invalidate(`${SERVICE}:${tenantId}:rate_slabs:${rateHeadId}`);
    await cache.invalidate(`${SERVICE}:${tenantId}:penalty_rules:${rateHeadId}`);
    await cache.invalidate(`${SERVICE}:${tenantId}:rebate_rules:${rateHeadId}`);
  }
}

const toProposal = (row: typeof configProposals.$inferSelect): Proposal => ({
  id: row.id,
  kind: row.kind as Proposal["kind"],
  action: row.action as Proposal["action"],
  targetId: row.targetId ?? null,
  rateHeadId: row.rateHeadId ?? null,
  effectiveFrom: typeof row.effectiveFrom === "string" ? row.effectiveFrom : String(row.effectiveFrom),
  payload: (row.payload ?? {}) as Record<string, unknown>,
});

/**
 * Owner decision #2 (2026-10-26, GAP-REVENUE-CONFIG-01): rate configuration is
 * maker-checker. `rateConfigPropose` records a PENDING proposal (and refuses one
 * that could never apply); `rateConfigDecide` lets a DIFFERENT officer approve
 * (apply, in one transaction with markProcessed + guarded write + audit) or
 * reject it.
 */
export function registerRateConfigConsumers(queue: Queue): void {
  // ─── rateConfigPropose (maker step) ───────────────────────────────────────
  queue.subscribe(COMMANDS.rateConfigPropose, async (msg) => {
    const p = msg.payload as {
      id: string; kind: Proposal["kind"]; action: Proposal["action"]; targetId?: string | null;
      rateHeadId?: string | null; effectiveFrom: string; payload?: Record<string, unknown>;
    };

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const proposal: Proposal = {
        id: p.id, kind: p.kind, action: p.action, targetId: p.targetId ?? null,
        rateHeadId: p.rateHeadId ?? null, effectiveFrom: p.effectiveFrom, payload: p.payload ?? {},
      };
      // Refuse a proposal that could never apply (overlap, unknown target, past date ...)
      // — nothing is stored and the command fails visibly.
      const state = await loadConfigStateTx(tx, msg.tenantId);
      planProposal(state, proposal, istToday());

      await tx.insert(configProposals).values({
        id: proposal.id,
        tenantId: msg.tenantId,
        kind: proposal.kind,
        action: proposal.action,
        targetId: proposal.targetId,
        rateHeadId: proposal.rateHeadId,
        effectiveFrom: proposal.effectiveFrom,
        payload: proposal.payload,
        status: "pending",
        makerUserId: msg.actorId,
      });

      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: SERVICE, action: "propose", resourceType: "rate_config", resourceId: proposal.id, outcome: "pending",
          kind: proposal.kind, configAction: proposal.action, targetId: proposal.targetId, effectiveFrom: proposal.effectiveFrom,
        },
      });
    });
  });

  // ─── rateConfigDecide (checker step) ──────────────────────────────────────
  queue.subscribe(COMMANDS.rateConfigDecide, async (msg) => {
    const { proposalId, approve, reason } = msg.payload as { proposalId: string; approve: boolean; reason?: string };
    let headToInvalidate: string | null = null;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const rows = await tx
        .select()
        .from(configProposals)
        .where(and(eq(configProposals.tenantId, msg.tenantId), eq(configProposals.id, proposalId)))
        .limit(1);
      const row = rows[0];
      if (!row) return;

      const audit = (outcome: string, extra: Record<string, unknown> = {}) =>
        enqueue(tx, {
          topic: AUDIT_TOPIC,
          eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            service: SERVICE, action: "decide", resourceType: "rate_config", resourceId: proposalId, outcome,
            kind: row.kind, configAction: row.action, targetId: row.targetId ?? null, reason: reason ?? null, ...extra,
          },
        });

      if (row.status !== "pending") {
        await audit("already_decided");
        return;
      }

      // Segregation of duties, enforced in the consumer.
      assertMakerChecker(row.makerUserId, msg.actorId);
      headToInvalidate = row.rateHeadId ?? null;

      if (!approve) {
        const claimed = await tx
          .update(configProposals)
          .set({ status: "rejected", checkerUserId: msg.actorId, decidedAt: new Date(), decisionReason: reason ?? null })
          .where(and(eq(configProposals.id, proposalId), eq(configProposals.tenantId, msg.tenantId), eq(configProposals.status, "pending")))
          .returning({ id: configProposals.id });
        if (claimed.length > 0) await audit("rejected");
        return;
      }

      // Re-plan against the CURRENT state: the config may have changed since the
      // proposal was made. If it no longer applies, leave it pending and audit
      // (not thrown: that would roll back markProcessed and redeliver forever).
      const state = await loadConfigStateTx(tx, msg.tenantId);
      let ops: PlanOp[];
      try {
        ops = planProposal(state, toProposal(row), istToday());
      } catch (err) {
        if (!(err instanceof DomainError)) throw err;
        await audit("not_applicable", { reasonCode: err.code });
        return;
      }

      const claimed = await tx
        .update(configProposals)
        .set({ status: "approved", checkerUserId: msg.actorId, decidedAt: new Date(), decisionReason: reason ?? null })
        .where(and(eq(configProposals.id, proposalId), eq(configProposals.tenantId, msg.tenantId), eq(configProposals.status, "pending")))
        .returning({ id: configProposals.id });
      if (claimed.length === 0) return; // lost a race to another decider

      const appliedRef = await executeOps(tx, msg.tenantId, msg.actorId, ops);
      if (appliedRef) {
        await tx.update(configProposals).set({ appliedRef }).where(eq(configProposals.id, proposalId));
      }

      await audit("approved", { appliedRef, effectiveFrom: toProposal(row).effectiveFrom });
    });

    await invalidate(msg.tenantId, headToInvalidate);
  });
}
