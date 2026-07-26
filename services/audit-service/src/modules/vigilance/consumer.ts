import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, CONSUMED_EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import {
  assertStageTransition, assertCanScreen, assertCanAssignIo, assertDifferentActor,
  type VigilanceStage, type ScreeningStatus,
} from "./domain.js";

const AUDIT_TOPIC = CONSUMED_EVENTS.auditEventRecord;

class StaleWriteError extends Error {
  readonly status = 409;
  readonly code = "VERSION_CONFLICT";
  constructor(resource: string, id: string) {
    super(`[VERSION_CONFLICT] ${resource} ${id} was modified concurrently`);
  }
}

export function registerVigilanceConsumers(queue: Queue): void {
  // ── CONFIDENTIAL intake ────────────────────────────────────────────────
  queue.subscribe(COMMANDS.vigilanceIntake, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; caseNo: string; officer: string; charges: string;
      complaintSource?: string; confidential?: boolean;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertCase(tx, {
        id: p.id, tenantId: p.tenantId, caseNo: p.caseNo, officer: p.officer, charges: p.charges,
        complaintSource: p.complaintSource ?? null, confidential: p.confidential ?? true,
        stage: "intake", screeningStatus: "pending",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "intake", "vigilance_case", p.id, { caseNo: p.caseNo });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "vigilance", "list:50:0"));
  });

  // ── screening (admit / reject) ───────────────────────────────────────────
  queue.subscribe(COMMANDS.vigilanceScreen, async (msg) => {
    const p = msg.payload as { caseId: string; tenantId: string; decision: "admitted" | "rejected"; remarks?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const c = await repo.findByIdTx(tx, p.caseId, p.tenantId);
      if (!c) throw new Error(`vigilance case ${p.caseId} not found`);
      assertCanScreen(c.stage as VigilanceStage);
      const nextStage: VigilanceStage = p.decision === "rejected" ? "closed" : "screening";
      const n = await repo.updateCaseVersioned(tx, p.caseId, p.tenantId, c.version ?? 1, {
        screeningStatus: p.decision, stage: nextStage,
        ...(p.decision === "rejected" ? { outcome: "closed", closedAt: new Date() } : {}),
        updatedBy: msg.actorId, version: (c.version ?? 1) + 1,
      });
      if (n !== 1) throw new StaleWriteError("vigilance_case", p.caseId);
      await audit(tx, msg, "screen", "vigilance_case", p.caseId, { decision: p.decision });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "vigilance", p.caseId));
  });

  // ── assign IO (only after admission) ─────────────────────────────────────
  queue.subscribe(COMMANDS.vigilanceAssignIo, async (msg) => {
    const p = msg.payload as { caseId: string; tenantId: string; assignedIo: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const c = await repo.findByIdTx(tx, p.caseId, p.tenantId);
      if (!c) throw new Error(`vigilance case ${p.caseId} not found`);
      assertCanAssignIo(c.screeningStatus as ScreeningStatus);
      assertStageTransition(c.stage as VigilanceStage, "assigned");
      const n = await repo.updateCaseVersioned(tx, p.caseId, p.tenantId, c.version ?? 1, {
        assignedIo: p.assignedIo, stage: "assigned", inquiryStatus: "under_investigation",
        updatedBy: msg.actorId, version: (c.version ?? 1) + 1,
      });
      if (n !== 1) throw new StaleWriteError("vigilance_case", p.caseId);
      await audit(tx, msg, "assign_io", "vigilance_case", p.caseId, { assignedIo: p.assignedIo });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "vigilance", p.caseId));
  });

  // ── evidence ─────────────────────────────────────────────────────────────
  queue.subscribe(COMMANDS.vigilanceEvidence, async (msg) => {
    const p = msg.payload as {
      id: string; caseId: string; tenantId: string; kind: string; description: string;
      reference?: string; collectedBy?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const c = await repo.findByIdTx(tx, p.caseId, p.tenantId);
      if (!c) throw new Error(`vigilance case ${p.caseId} not found`);
      // move into investigation on first evidence if still 'assigned'
      if (c.stage === "assigned") {
        await repo.updateCaseVersioned(tx, p.caseId, p.tenantId, c.version ?? 1, {
          stage: "under_investigation", updatedBy: msg.actorId, version: (c.version ?? 1) + 1,
        });
      }
      await repo.insertEvidence(tx, {
        id: p.id, tenantId: p.tenantId, caseId: p.caseId, kind: p.kind, description: p.description,
        reference: p.reference ?? null, collectedBy: p.collectedBy ?? null, createdBy: msg.actorId,
      });
      await audit(tx, msg, "add_evidence", "vigilance_case", p.caseId, { evidenceId: p.id });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "vigilance", p.caseId));
  });

  // ── preliminary inquiry findings ─────────────────────────────────────────
  queue.subscribe(COMMANDS.vigilanceFindings, async (msg) => {
    const p = msg.payload as { caseId: string; tenantId: string; findings: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const c = await repo.findByIdTx(tx, p.caseId, p.tenantId);
      if (!c) throw new Error(`vigilance case ${p.caseId} not found`);
      assertStageTransition(c.stage as VigilanceStage, "findings");
      const n = await repo.updateCaseVersioned(tx, p.caseId, p.tenantId, c.version ?? 1, {
        findings: p.findings, stage: "findings", inquiryStatus: "inquiry_complete",
        updatedBy: msg.actorId, version: (c.version ?? 1) + 1,
      });
      if (n !== 1) throw new StaleWriteError("vigilance_case", p.caseId);
      await audit(tx, msg, "record_findings", "vigilance_case", p.caseId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "vigilance", p.caseId));
  });

  // ── propose action (maker) ───────────────────────────────────────────────
  queue.subscribe(COMMANDS.vigilanceProposeAction, async (msg) => {
    const p = msg.payload as {
      id: string; caseId: string; tenantId: string; recommendation: string; recommendedAction: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const c = await repo.findByIdTx(tx, p.caseId, p.tenantId);
      if (!c) throw new Error(`vigilance case ${p.caseId} not found`);
      assertStageTransition(c.stage as VigilanceStage, "action_recommended");
      await repo.insertAction(tx, {
        id: p.id, tenantId: p.tenantId, caseId: p.caseId, recommendation: p.recommendation,
        recommendedAction: p.recommendedAction, status: "proposed", proposedBy: msg.actorId,
      });
      await repo.updateCaseVersioned(tx, p.caseId, p.tenantId, c.version ?? 1, {
        stage: "action_recommended", updatedBy: msg.actorId, version: (c.version ?? 1) + 1,
      });
      await audit(tx, msg, "propose_action", "vigilance_action", p.id, { recommendedAction: p.recommendedAction });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "vigilance", p.caseId));
  });

  // ── decide action (checker) — maker-checker enforced ─────────────────────
  queue.subscribe(COMMANDS.vigilanceDecideAction, async (msg) => {
    const p = msg.payload as { actionId: string; tenantId: string; decision: "approved" | "rejected"; remarks?: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const action = await repo.findActionByIdTx(tx, p.actionId, p.tenantId);
      if (!action) throw new Error(`vigilance action ${p.actionId} not found`);
      if (action.status !== "proposed") throw new Error(`action ${p.actionId} already decided`);
      // Maker-checker: the deciding authority must differ from the proposer.
      assertDifferentActor(action.proposedBy, msg.actorId, "vigilance action");
      const n = await repo.updateActionVersioned(tx, p.actionId, p.tenantId, action.version ?? 1, {
        status: p.decision, remarks: p.remarks ?? null, decidedBy: msg.actorId, decidedAt: new Date(),
        version: (action.version ?? 1) + 1,
      });
      if (n !== 1) throw new StaleWriteError("vigilance_action", p.actionId);
      // On approval, close the case with the recommended outcome.
      if (p.decision === "approved") {
        const c = await repo.findByIdTx(tx, action.caseId, p.tenantId);
        if (c) {
          await repo.updateCaseVersioned(tx, c.id, p.tenantId, c.version ?? 1, {
            outcome: "action_taken", stage: "closed", closedAt: new Date(),
            updatedBy: msg.actorId, version: (c.version ?? 1) + 1,
          });
        }
      }
      await audit(tx, msg, "decide_action", "vigilance_action", p.actionId, { decision: p.decision });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "vigilance", "list:50:0"));
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
