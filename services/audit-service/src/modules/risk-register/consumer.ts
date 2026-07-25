import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, CONSUME_TOPICS } from "../../topics.js";
import * as repo from "./repo.js";
import { assertDifferentActor, computeNextReviewDate, type ReviewCadence } from "./domain.js";

const AUDIT_TOPIC = CONSUME_TOPICS.auditEventRecord;

class StaleWriteError extends Error {
  readonly status = 409;
  readonly code = "VERSION_CONFLICT";
  constructor(resource: string, id: string) {
    super(`[VERSION_CONFLICT] ${resource} ${id} was modified concurrently`);
  }
}

const RESULT_TO_EFFECTIVENESS: Record<string, string> = {
  pass: "effective",
  partial: "partial",
  fail: "ineffective",
};

export function registerRiskRegisterConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.riskControlCreate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; riskId: string; controlCode: string; description: string; controlType: string; owner?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertControl(tx, {
        id: p.id, tenantId: p.tenantId, riskId: p.riskId, controlCode: p.controlCode,
        description: p.description, controlType: p.controlType, ownerRef: p.owner ?? null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "risk_control", p.id, { controlCode: p.controlCode });
    });
  });

  queue.subscribe(COMMANDS.riskControlTest, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; controlId: string; result: string; testedBy?: string; notes?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const control = await repo.findControlByIdTx(tx, p.controlId, p.tenantId);
      if (!control) throw new Error(`risk control ${p.controlId} not found`);
      await repo.insertControlTest(tx, {
        id: p.id, tenantId: p.tenantId, controlId: p.controlId, result: p.result,
        testedBy: p.testedBy ?? null, testDate: new Date().toISOString().slice(0, 10), notes: p.notes ?? null,
        createdBy: msg.actorId,
      });
      const n = await repo.updateControlVersioned(tx, p.controlId, p.tenantId, control.version ?? 1, {
        effectiveness: RESULT_TO_EFFECTIVENESS[p.result] ?? "not_tested",
        updatedBy: msg.actorId, version: (control.version ?? 1) + 1,
      });
      if (n !== 1) throw new StaleWriteError("risk_control", p.controlId);
      await audit(tx, msg, "test", "risk_control", p.controlId, { result: p.result });
    });
  });

  queue.subscribe(COMMANDS.riskIncidentCreate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; riskId?: string; title: string; description: string; severity: string; reportedBy?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertIncident(tx, {
        id: p.id, tenantId: p.tenantId, riskId: p.riskId ?? null, title: p.title,
        description: p.description, severity: p.severity, reportedBy: p.reportedBy ?? null,
        createdBy: msg.actorId,
      });
      await audit(tx, msg, "create", "risk_incident", p.id, { severity: p.severity });
    });
  });

  queue.subscribe(COMMANDS.riskMitigationCreate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; riskId: string; action: string; owner?: string; dueDate?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertMitigation(tx, {
        id: p.id, tenantId: p.tenantId, riskId: p.riskId, action: p.action,
        ownerRef: p.owner ?? null, dueDate: p.dueDate ?? null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "risk_mitigation", p.id);
    });
  });

  // ── risk acceptance — maker (propose) ────────────────────────────────────
  queue.subscribe(COMMANDS.riskAcceptancePropose, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; riskId: string; rationale: string; residualScore: number; validUntil?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertAcceptance(tx, {
        id: p.id, tenantId: p.tenantId, riskId: p.riskId, rationale: p.rationale,
        residualScore: p.residualScore, status: "proposed", validUntil: p.validUntil ?? null,
        requestedBy: msg.actorId,
      });
      await audit(tx, msg, "propose", "risk_acceptance", p.id, { riskId: p.riskId });
    });
  });

  // ── risk acceptance — checker (decide), maker-checker enforced ────────────
  queue.subscribe(COMMANDS.riskAcceptanceDecide, async (msg) => {
    const p = msg.payload as { acceptanceId: string; tenantId: string; decision: "approved" | "rejected"; remarks?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const acc = await repo.findAcceptanceByIdTx(tx, p.acceptanceId, p.tenantId);
      if (!acc) throw new Error(`risk acceptance ${p.acceptanceId} not found`);
      if (acc.status !== "proposed") throw new Error(`acceptance ${p.acceptanceId} already decided`);
      assertDifferentActor(acc.requestedBy, msg.actorId, "risk acceptance");
      const n = await repo.updateAcceptanceVersioned(tx, p.acceptanceId, p.tenantId, acc.version ?? 1, {
        status: p.decision, remarks: p.remarks ?? null, decidedBy: msg.actorId, decidedAt: new Date(),
        version: (acc.version ?? 1) + 1,
      });
      if (n !== 1) throw new StaleWriteError("risk_acceptance", p.acceptanceId);
      await audit(tx, msg, "decide", "risk_acceptance", p.acceptanceId, { decision: p.decision });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "risk_acceptance", p.acceptanceId));
  });

  // ── periodic review cycle ─────────────────────────────────────────────────
  queue.subscribe(COMMANDS.riskReview, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; riskId: string; outcome: string; cadence: ReviewCadence; reviewedBy?: string; notes?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const reviewedAt = new Date();
      await repo.insertReview(tx, {
        id: p.id, tenantId: p.tenantId, riskId: p.riskId, outcome: p.outcome,
        reviewedBy: p.reviewedBy ?? null, notes: p.notes ?? null, reviewedAt,
        nextReviewDate: computeNextReviewDate(reviewedAt, p.cadence).toISOString().slice(0, 10),
        createdBy: msg.actorId,
      });
      await audit(tx, msg, "review", "risk", p.riskId, { outcome: p.outcome, cadence: p.cadence });
    });
  });
}

async function audit(
  tx: Parameters<typeof enqueue>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string, resourceType: string, resourceId: string, newValue?: Record<string, unknown>,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "audit", action, resourceType, resourceId, outcome: "success", ...(newValue ? { newValue } : {}) },
  });
}
