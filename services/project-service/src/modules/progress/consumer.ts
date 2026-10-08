import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as projectRepo from "../project/repo.js";
import { assertDprDateUnique } from "./domain.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

void assertDprDateUnique;

const AUDIT_TOPIC = "audit.event.record";

export function registerProgressConsumers(queue: Queue): void {
  // RLS (#146): every handler must run inside the message's tenant context.
  queue = tenantScoped(queue);
  queue.subscribe(COMMANDS.physicalProgressRecord, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; projectId: string; componentId?: string;
      periodDate: string; physicalPct: number; notes?: string; reportedBy: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertPhysicalProgress(tx, {
        id: p.id, projectId: p.projectId, componentId: p.componentId ?? null,
        tenantId: p.tenantId, periodDate: p.periodDate,
        physicalPct: String(p.physicalPct),
        cumulativePct: String(p.physicalPct),
        reportedBy: p.reportedBy, notes: p.notes ?? null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      // P0-1: roll the latest cumulative physical % up onto the project aggregate.
      const latestPct = await repo.latestCumulativePctTx(tx, p.projectId, p.tenantId);
      if (latestPct !== null) {
        await projectRepo.updateProjectProgressTx(tx, p.projectId, p.tenantId, { physicalPct: latestPct });
      }
      await enqueue(tx, {
        topic: EVENTS.physicalProgressRecorded, eventType: EVENTS.physicalProgressRecorded,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { recordId: p.id, projectId: p.projectId, physicalPct: p.physicalPct },
      });
      await audit(tx, msg, "record", "physical_progress", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "progress", p.projectId));
    // P0-1: project aggregate physical_pct changed -> bust the project cache too.
    await cache.invalidate(cache.makeKey(msg.tenantId, "project", p.projectId));
  });

  queue.subscribe(COMMANDS.financialProgressRecord, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; projectId: string; periodDate: string;
      expenditureMinor: number; notes?: string; reportedBy: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertFinancialProgress(tx, {
        id: p.id, projectId: p.projectId, tenantId: p.tenantId,
        periodDate: p.periodDate, expenditureMinor: BigInt(p.expenditureMinor),
        cumulativeMinor: BigInt(p.expenditureMinor),
        reportedBy: p.reportedBy, notes: p.notes ?? null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      // P0-1: recompute financial_pct = cumulative expenditure / sanctioned (paise bigint math).
      const project = await projectRepo.findProjectByIdTx(tx, p.projectId, p.tenantId);
      if (project) {
        const sanctioned = project.sanctionedMinor ?? 0n;
        const spent = await repo.totalExpenditureMinorTx(tx, p.projectId, p.tenantId);
        let pct = "0.00";
        if (sanctioned > 0n) {
          // basis points then scale to 2dp, capped at 100.00
          const bps = (spent * 10000n) / sanctioned;
          const capped = bps > 10000n ? 10000n : bps;
          pct = (Number(capped) / 100).toFixed(2);
        }
        await projectRepo.updateProjectProgressTx(tx, p.projectId, p.tenantId, { financialPct: pct });
      }
      await audit(tx, msg, "record", "financial_progress", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "progress", p.projectId));
    // P0-1: project aggregate financial_pct changed -> bust the project cache too.
    await cache.invalidate(cache.makeKey(msg.tenantId, "project", p.projectId));
  });

  queue.subscribe(COMMANDS.dprSubmit, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; projectId: string; dprNo: string;
      dprDate: string; content?: Record<string, unknown>; submittedBy: string;
    };

    // DPR immutability: no duplicate for same project + date
    const existing = await repo.findDprByProjectAndDate(p.projectId, p.dprDate, p.tenantId);
    if (existing) {
      // DPR for this date already exists — do not overwrite; idempotent ack
      return;
    }

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertDpr(tx, {
        id: p.id, projectId: p.projectId, tenantId: p.tenantId,
        dprNo: p.dprNo, dprDate: p.dprDate,
        content: p.content ?? {}, submittedBy: p.submittedBy,
        submittedAt: new Date(),
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.dprSubmitted, eventType: EVENTS.dprSubmitted,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { dprId: p.id, projectId: p.projectId, dprDate: p.dprDate },
      });
      await audit(tx, msg, "submit", "dpr", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "progress", p.projectId));
  });

  // GAP-PROJECTS-DPR-TRACKING-01: DPR review workflow transition. The valid
  // state machine (matches progress.project_dprs's status CHECK):
  //   review:  submitted    → under_review
  //   approve: under_review → approved
  //   return:  under_review → revision
  // The transition is enforced server-side (source status + optimistic
  // version guard in repo.transitionDprTx) and audited in the SAME transaction.
  queue.subscribe(COMMANDS.dprTransition, async (msg) => {
    const p = msg.payload as {
      dprId: string; tenantId: string; projectId: string;
      action: "review" | "approve" | "return"; reason: string | null;
    };
    const target: Record<string, { from: string; to: string; auditAction: string }> = {
      review:  { from: "submitted",    to: "under_review", auditAction: "dpr_review" },
      approve: { from: "under_review", to: "approved",     auditAction: "dpr_approve" },
      return:  { from: "under_review", to: "revision",     auditAction: "dpr_return" },
    };
    const t = target[p.action];
    if (!t) return; // unknown action — drop (route already validates, defence-in-depth)

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const dpr = await repo.findDprByIdTx(tx, p.dprId, p.projectId, p.tenantId);
      // Not found, or not in the required source state → idempotent no-op (a
      // replay or a stale/duplicate transition). No audit for a no-op.
      if (!dpr || dpr.status !== t.from) return;
      const updated = await repo.transitionDprTx(
        tx, p.dprId, p.tenantId, t.from, t.to, msg.actorId, p.reason, dpr.version ?? 1,
      );
      if (updated === 0) return; // lost the optimistic-lock race → no-op, no audit
      await enqueue(tx, {
        topic: EVENTS.dprTransitioned, eventType: EVENTS.dprTransitioned,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { dprId: p.dprId, projectId: p.projectId, from: t.from, to: t.to },
      });
      await audit(tx, msg, t.auditAction, "dpr", p.dprId, p.reason ?? undefined);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "progress", p.projectId));
  });
}

async function audit(tx: Parameters<typeof enqueue>[0], msg: Pick<CommandEnvelope, "tenantId" | "actorId" | "correlationId">, action: string, resourceType: string, resourceId: string, reason?: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "project", action, resourceType, resourceId, outcome: "success", ...(reason ? { reason } : {}) },
  });
}
