import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, CONSUME_TOPICS } from "../../topics.js";
import * as repo from "./repo.js";
import { assertCanTransition } from "./domain.js";

const AUDIT_TOPIC = CONSUME_TOPICS.auditEventRecord;

/** Raised when an optimistic-locked update affects 0 rows (stale version / cross-tenant). */
class StaleWriteError extends Error {
  readonly status = 409;
  readonly code = "VERSION_CONFLICT";
  constructor(resource: string, id: string) {
    super(`[VERSION_CONFLICT] ${resource} ${id} was modified concurrently`);
  }
}

export function registerObservationConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.observationCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; obsNo: string; planId?: string; auditeeRef: string;
      // P0-3: amountInvolvedMinor (PAISE) carried as string end-to-end; BigInt()-parsed here.
      finding: string; category?: string; riskLevel?: string; amountInvolvedMinor?: string | number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertObservation(tx, {
        id: p.id, tenantId: p.tenantId, obsNo: p.obsNo, planId: p.planId ?? null,
        auditeeRef: p.auditeeRef, finding: p.finding, category: p.category ?? "compliance",
        riskLevel: p.riskLevel ?? "medium", amountInvolvedMinor: BigInt(p.amountInvolvedMinor ?? 0n),
        status: "open", createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "observation", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "observations", `list:50`));
  });

  /**
   * AU-01: Auditee submits compliance reply — transitions observation → "replied".
   * The reply text is stored in payload; a dedicated reply table would be used in a
   * full implementation — here we update status and store reply in the observation payload.
   */
  queue.subscribe(COMMANDS.observationReply, async (msg) => {
    const p = msg.payload as {
      id: string; observationId: string; tenantId: string;
      replyText: string; respondedByRef: string; attachmentRef?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const obs = await repo.findObservationByIdTx(tx, p.observationId, p.tenantId);
      if (!obs) throw new Error(`observation ${p.observationId} not found`);
      // Only allow reply when observation is open or previously rejected
      if (!["open", "replied_rejected"].includes(obs.status ?? "open")) {
        throw new Error(`[INVALID_STATUS] observation status '${obs.status}' cannot receive a reply`);
      }
      const replyRows = await repo.updateObservationVersioned(tx, p.observationId, p.tenantId, obs.version ?? 1, {
        status: "replied", updatedBy: msg.actorId, version: (obs.version ?? 1) + 1,
      });
      if (replyRows !== 1) throw new StaleWriteError("observation", p.observationId);
      await audit(tx, msg, "reply", "observation", p.observationId);
      // Notify the audit team
      await enqueue(tx, {
        topic: "notification.send", eventType: "notification.send",
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          channel: "email",
          recipient: obs.auditeeRef,
          subject: `Compliance reply received for ${obs.obsNo}`,
          body: `Auditee ${p.respondedByRef} submitted a compliance reply.`,
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "observation", p.observationId));
    await cache.invalidate(cache.makeKey(msg.tenantId, "observations", `list:50`));
  });

  /**
   * AU-01: Auditor reviews the reply — "accepted" closes/moves to compliance_pending, "rejected" → back to open.
   * Closed observations can only be re-opened by audit_admin (enforced at route layer by REVIEW_ROLES).
   */
  queue.subscribe(COMMANDS.observationReview, async (msg) => {
    const p = msg.payload as {
      id: string; observationId: string; tenantId: string;
      decision: "accepted" | "rejected"; remarks?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const obs = await repo.findObservationByIdTx(tx, p.observationId, p.tenantId);
      if (!obs) throw new Error(`observation ${p.observationId} not found`);
      if (obs.status !== "replied") {
        throw new Error(`[INVALID_STATUS] can only review a 'replied' observation, got '${obs.status}'`);
      }
      const newStatus = p.decision === "accepted" ? "compliance_pending" : "replied_rejected";
      const reviewRows = await repo.updateObservationVersioned(tx, p.observationId, p.tenantId, obs.version ?? 1, {
        status: newStatus, updatedBy: msg.actorId, version: (obs.version ?? 1) + 1,
      });
      if (reviewRows !== 1) throw new StaleWriteError("observation", p.observationId);
      await audit(tx, msg, p.decision === "accepted" ? "reply_accepted" : "reply_rejected", "observation", p.observationId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "observation", p.observationId));
    await cache.invalidate(cache.makeKey(msg.tenantId, "observations", `list:50`));
  });

  /**
   * P1-6: closure transition — moves an observation to "closed" (full) or
   * "partially_closed" (partial). Allowed source states are governed by the
   * lifecycle graph in domain.ts (compliance_pending / partially_closed / para_drafted / open).
   */
  queue.subscribe(COMMANDS.observationClose, async (msg) => {
    const p = msg.payload as {
      id: string; observationId: string; tenantId: string;
      mode: "full" | "partial"; closureRemarks: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const obs = await repo.findObservationByIdTx(tx, p.observationId, p.tenantId);
      if (!obs) throw new Error(`observation ${p.observationId} not found`);
      const target = p.mode === "partial" ? "partially_closed" : "closed";
      assertCanTransition(obs.status ?? "open", target);
      // C1/M1: full closure additionally requires no outstanding paras/pending-register rows.
      if (target === "closed") {
        const blockers = await repo.countOpenBlockers(tx, p.observationId, p.tenantId);
        if (blockers > 0) {
          throw new Error(`[CLOSURE_BLOCKED] observation ${p.observationId} has ${blockers} open para(s) or unsettled pending-register row(s)`);
        }
      }
      const rows = await repo.updateObservationVersioned(tx, p.observationId, p.tenantId, obs.version ?? 1, {
        status: target, updatedBy: msg.actorId, version: (obs.version ?? 1) + 1,
      });
      if (rows !== 1) throw new StaleWriteError("observation", p.observationId);
      await audit(tx, msg, p.mode === "partial" ? "partial_close" : "close", "observation", p.observationId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "observation", p.observationId));
    await cache.invalidate(cache.makeKey(msg.tenantId, "observations", `list:50`));
  });
}

async function audit(tx: any, msg: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "audit", action, resourceType, resourceId, outcome: "success" },
  });
}
