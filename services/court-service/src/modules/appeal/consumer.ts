import { NonRetryableError, type CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed, versionedUpdate } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { appeals } from "./schema.js";
import * as repo from "./repo.js";
import { assertTransition, type AppealStatus } from "./domain.js";

type FileAppealPayload = {
  id: string;
  tenantId: string;
  originalCaseId: string;
  appealType: string;
  grounds: string;
  filedDate: string; // YYYY-MM-DD
};

type RegisterAppealPayload = {
  appealId: string;
  tenantId: string;
  expectedVersion: number;
};

type DecideAppealPayload = {
  appealId: string;
  tenantId: string;
  decision: "allowed" | "dismissed" | "remanded" | "modified";
  decisionSummary: string;
  decidedDate: string; // YYYY-MM-DD
  expectedVersion: number;
};

type WithdrawAppealPayload = {
  appealId: string;
  tenantId: string;
  expectedVersion: number;
};

/**
 * appeal consumer — the appeal state machine (§25), enforced.
 *
 * fileAppeal inserts the row in 'filed' (idempotent on the deterministic id).
 * register/decide/withdraw share ONE tenant-scoped tx shape: markProcessed dedupe
 * → read current (status, version) → no-op if already at target → reject a stale
 * optimistic-lock token → reject an illegal transition → version-guarded write
 * (atomic version bump) → emit appealStatusChanged + audit, all together.
 *
 * Not-found / version-conflict / illegal-transition are NonRetryableError so they
 * dead-letter for investigation instead of retrying forever (retrying cannot fix
 * a stale version or an illegal edge).
 */
export function registerAppealConsumers(
  register: <T>(topic: string, handler: (msg: CommandEnvelope<T>) => Promise<void>) => void,
): void {
  // File an appeal (§25).
  register<FileAppealPayload>(COMMANDS.fileAppeal, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return; // exactly-once
      await repo.insertAppeal(tx, {
        id: p.id,
        tenantId: p.tenantId,
        originalCaseId: p.originalCaseId,
        appealType: p.appealType,
        grounds: p.grounds,
        status: "filed",
        filedDate: p.filedDate,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.appealFiled,
        eventType: EVENTS.appealFiled,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          appealId: p.id,
          originalCaseId: p.originalCaseId,
          appealType: p.appealType,
          status: "filed",
        },
      });
      await audit(tx, msg, "file", "court_appeal", p.id);
    });
  });

  // Register a filed appeal (§25) — version-guarded, state-machine-checked.
  register<RegisterAppealPayload>(COMMANDS.registerAppeal, async (msg) => {
    const p = msg.payload;
    await transition(msg, p.appealId, p.tenantId, p.expectedVersion, "registered", {});
  });

  // Decide a registered appeal (§25) — sets decided fields; target = the decision.
  register<DecideAppealPayload>(COMMANDS.decideAppeal, async (msg) => {
    const p = msg.payload;
    await transition(msg, p.appealId, p.tenantId, p.expectedVersion, p.decision, {
      decidedDate: p.decidedDate,
      decisionSummary: p.decisionSummary,
    });
  });

  // Withdraw a filed or registered appeal (§25).
  register<WithdrawAppealPayload>(COMMANDS.withdrawAppeal, async (msg) => {
    const p = msg.payload;
    await transition(msg, p.appealId, p.tenantId, p.expectedVersion, "withdrawn", {});
  });
}

/**
 * Shared version-guarded, state-machine-checked transition for the
 * register/decide/withdraw handlers. `extra` carries the decided fields when the
 * target is a decision status. Mirrors the case-lifecycle consumer flow exactly.
 */
async function transition(
  msg: CommandEnvelope<{ tenantId: string }>,
  appealId: string,
  tenantId: string,
  expectedVersion: number,
  target: AppealStatus,
  extra: { decidedDate?: string; decisionSummary?: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return; // exactly-once

    const current = await repo.getAppealForUpdate(tx, tenantId, appealId);
    if (!current) throw new NonRetryableError(`APPEAL_NOT_FOUND: ${appealId}`);

    // Already at target → transition is done; no-op (redelivery-safe).
    if (current.status === target) return;

    // Stale optimistic-lock token → a concurrent update happened; do not retry.
    if (current.version !== expectedVersion) {
      throw new NonRetryableError(
        `VERSION_CONFLICT: appeal ${appealId} expected v${expectedVersion}, found v${current.version}`,
      );
    }

    // Illegal edge per the state machine → do not retry.
    try {
      assertTransition(current.status, target);
    } catch (e) {
      throw new NonRetryableError((e as Error).message);
    }

    await versionedUpdate(tx, appeals, {
      id: appealId,
      tenantId,
      expectedVersion,
      set: {
        status: target,
        ...(extra.decidedDate !== undefined ? { decidedDate: extra.decidedDate } : {}),
        ...(extra.decisionSummary !== undefined ? { decisionSummary: extra.decisionSummary } : {}),
        updatedBy: msg.actorId,
        updatedAt: new Date(),
      },
      entity: "appeal",
    });

    await enqueue(tx, {
      topic: EVENTS.appealStatusChanged,
      eventType: EVENTS.appealStatusChanged,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: {
        appealId,
        from: current.status,
        to: target,
        decisionSummary: extra.decisionSummary ?? null,
      },
    });

    await audit(tx, msg, "status_change", "court_appeal", appealId);
  });
}

async function audit(
  tx: Parameters<typeof markProcessed>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string,
  resourceType: string,
  resourceId: string,
): Promise<void> {
  await enqueue(tx, {
    topic: "audit.event.record",
    eventType: "audit.event.record",
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "court", action, resourceType, resourceId, outcome: "success" },
  });
}
