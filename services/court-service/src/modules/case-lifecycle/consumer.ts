import { NonRetryableError, type CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed, versionedUpdate } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { cases } from "../case-registry/schema.js";
import * as repo from "./repo.js";
import { assertTransition, deriveStage, type CaseStatus } from "./domain.js";

type UpdateCaseStatusPayload = {
  caseId: string;
  tenantId: string;
  toStatus: CaseStatus;
  expectedVersion: number;
  reason?: string;
};

/**
 * case-lifecycle consumer — the case status state machine, enforced.
 *
 * One tenant-scoped tx: markProcessed dedupe → read current (status, version) →
 * no-op if already at target → reject a stale optimistic-lock token → reject an
 * illegal transition → version-guarded write (atomic version bump) → append the
 * immutable state-transition row → emit caseStatusChanged + audit, all together.
 *
 * Not-found / version-conflict / illegal-transition are NonRetryableError so they
 * dead-letter for investigation instead of retrying forever (retrying cannot fix
 * a stale version or an illegal edge).
 */
export function registerCaseLifecycleConsumers(
  register: <T>(topic: string, handler: (msg: CommandEnvelope<T>) => Promise<void>) => void,
): void {
  register<UpdateCaseStatusPayload>(COMMANDS.updateCaseStatus, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return; // exactly-once

      const current = await repo.getCaseForUpdate(tx, p.tenantId, p.caseId);
      if (!current) throw new NonRetryableError(`CASE_NOT_FOUND: ${p.caseId}`);

      // Already at target → transition is done; no-op (redelivery-safe).
      if (current.status === p.toStatus) return;

      // Stale optimistic-lock token → a concurrent update happened; do not retry.
      if (current.version !== p.expectedVersion) {
        throw new NonRetryableError(
          `VERSION_CONFLICT: case ${p.caseId} expected v${p.expectedVersion}, found v${current.version}`,
        );
      }

      // Illegal edge per the state machine → do not retry.
      try {
        assertTransition(current.status, p.toStatus);
      } catch (e) {
        throw new NonRetryableError((e as Error).message);
      }

      // Version-guarded write: applies the status only if version still matches,
      // bumping version atomically (throws VersionConflictError on a lost update).
      await versionedUpdate(tx, cases, {
        id: p.caseId,
        tenantId: p.tenantId,
        expectedVersion: p.expectedVersion,
        set: {
          status: p.toStatus,
          stage: deriveStage(p.toStatus),
          updatedBy: msg.actorId,
          updatedAt: new Date(),
        },
        entity: "case",
      });

      await repo.appendStateTransition(tx, {
        tenantId: p.tenantId,
        caseId: p.caseId,
        fromStatus: current.status,
        toStatus: p.toStatus,
        actorId: msg.actorId,
        reason: p.reason ?? "status_change",
        occurredAt: new Date(),
      });

      await enqueue(tx, {
        topic: EVENTS.caseStatusChanged,
        eventType: EVENTS.caseStatusChanged,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { caseId: p.caseId, from: current.status, to: p.toStatus, reason: p.reason ?? null },
      });

      await audit(tx, msg, "update_status", "court_case", p.caseId);
    });
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
