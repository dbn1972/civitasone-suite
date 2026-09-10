import { NonRetryableError, type CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed, versionedUpdate } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { hearings } from "./schema.js";
import * as repo from "./repo.js";
import * as configRepo from "../config-registry/repo.js";
import * as caseRepo from "../case-registry/repo.js";
import {
  assertTransition, DEFAULT_HEARING_PURPOSES, assertHearingPurposeAllowed, assertCaseOpenForHearing,
} from "./domain.js";
import { effectiveAllowed } from "../config-registry/domain.js";

type ScheduleHearingPayload = {
  id: string;
  caseId: string;
  tenantId: string;
  benchId?: string;
  scheduledAt: string; // ISO
  purpose?: string;
};

type AdjournHearingPayload = {
  hearingId: string;
  tenantId: string;
  reason: string;
  nextDate: string; // YYYY-MM-DD
  expectedVersion: number;
};

type RecordHearingOutcomePayload = {
  hearingId: string;
  tenantId: string;
  outcome: "held" | "cancelled";
  notes?: string;
  expectedVersion: number;
};

export function registerHearingConsumers(
  register: <T>(topic: string, handler: (msg: CommandEnvelope<T>) => Promise<void>) => void,
): void {
  // Schedule a hearing (§19).
  register<ScheduleHearingPayload>(COMMANDS.scheduleHearing, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // DOM-003 — the case must exist and must not already be in a terminal
      // state (disposed/appealed) before a hearing can be scheduled against
      // it. A real DB read inside THIS transaction, not anything the client
      // asserts. Mirrors order/consumer.ts's recordOrder guard (#1119).
      const theCase = await caseRepo.getCaseForUpdate(tx, p.tenantId, p.caseId);
      if (!theCase) throw new NonRetryableError(`CASE_NOT_FOUND: ${p.caseId}`);
      try {
        assertCaseOpenForHearing(p.caseId, theCase.status);
      } catch (e) {
        throw new NonRetryableError((e as Error).message);
      }

      // §47 config/metadata: purpose is OPTIONAL — validate ONLY when present
      // against the effective allowed set: the tenant’s configured `hearing_purpose`
      // values when any exist (AUTHORITATIVE — REPLACES the defaults), else
      // DEFAULT_HEARING_PURPOSES.
      if (p.purpose) {
        const configured = await configRepo.listActiveKeys(tx, p.tenantId, "hearing_purpose");
        const allowed = effectiveAllowed(configured, DEFAULT_HEARING_PURPOSES);
        try {
          assertHearingPurposeAllowed(p.purpose, allowed);
        } catch (e) {
          throw new NonRetryableError((e as Error).message);
        }
      }
      await repo.insertHearing(tx, {
        id: p.id,
        tenantId: p.tenantId,
        caseId: p.caseId,
        benchId: p.benchId ?? null,
        scheduledDate: new Date(p.scheduledAt),
        status: "scheduled",
        purpose: p.purpose ?? null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.hearingScheduled,
        eventType: EVENTS.hearingScheduled,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { caseId: p.caseId, hearingId: p.id, scheduledAt: p.scheduledAt, purpose: p.purpose ?? null },
      });
      await audit(tx, msg, "schedule", "court_hearing", p.id);
    });
  });

  // Adjourn a hearing (§20) — version-guarded, state-machine-checked.
  register<AdjournHearingPayload>(COMMANDS.adjournHearing, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const current = await repo.getHearingForUpdate(tx, p.tenantId, p.hearingId);
      if (!current) throw new NonRetryableError(`HEARING_NOT_FOUND: ${p.hearingId}`);
      if (current.status === "adjourned") return; // already adjourned; no-op

      // DOM-003 — the hearing's OWN case (read off the hearing row itself,
      // never anything the client asserts) must not already be terminal
      // (disposed/appealed) before this hearing can be adjourned.
      const theCase = await caseRepo.getCaseForUpdate(tx, p.tenantId, current.caseId);
      if (!theCase) throw new NonRetryableError(`CASE_NOT_FOUND: ${current.caseId}`);
      try {
        assertCaseOpenForHearing(current.caseId, theCase.status);
      } catch (e) {
        throw new NonRetryableError((e as Error).message);
      }

      if (current.version !== p.expectedVersion) {
        throw new NonRetryableError(
          `VERSION_CONFLICT: hearing ${p.hearingId} expected v${p.expectedVersion}, found v${current.version}`,
        );
      }
      try {
        assertTransition(current.status, "adjourned");
      } catch (e) {
        throw new NonRetryableError((e as Error).message);
      }

      await versionedUpdate(tx, hearings, {
        id: p.hearingId,
        tenantId: p.tenantId,
        expectedVersion: p.expectedVersion,
        set: {
          status: "adjourned",
          nextDate: p.nextDate,
          adjournmentReason: p.reason,
          updatedBy: msg.actorId,
          updatedAt: new Date(),
        },
        entity: "hearing",
      });

      await enqueue(tx, {
        topic: EVENTS.hearingAdjourned,
        eventType: EVENTS.hearingAdjourned,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { hearingId: p.hearingId, nextDate: p.nextDate, reason: p.reason },
      });
      await audit(tx, msg, "adjourn", "court_hearing", p.hearingId);
    });
  });

  // Record the final outcome of a hearing (§20) — version-guarded, state-machine-checked.
  register<RecordHearingOutcomePayload>(COMMANDS.recordHearingOutcome, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const current = await repo.getHearingForUpdate(tx, p.tenantId, p.hearingId);
      if (!current) throw new NonRetryableError(`HEARING_NOT_FOUND: ${p.hearingId}`);
      if (current.status === p.outcome) return; // already in target state; no-op

      // DOM-003 — the hearing's OWN case (read off the hearing row itself,
      // never anything the client asserts) must not already be terminal
      // (disposed/appealed) before this hearing's outcome can be recorded.
      const theCase = await caseRepo.getCaseForUpdate(tx, p.tenantId, current.caseId);
      if (!theCase) throw new NonRetryableError(`CASE_NOT_FOUND: ${current.caseId}`);
      try {
        assertCaseOpenForHearing(current.caseId, theCase.status);
      } catch (e) {
        throw new NonRetryableError((e as Error).message);
      }

      if (current.version !== p.expectedVersion) {
        throw new NonRetryableError(
          `VERSION_CONFLICT: hearing ${p.hearingId} expected v${p.expectedVersion}, found v${current.version}`,
        );
      }
      try {
        assertTransition(current.status, p.outcome);
      } catch (e) {
        throw new NonRetryableError((e as Error).message);
      }

      await versionedUpdate(tx, hearings, {
        id: p.hearingId,
        tenantId: p.tenantId,
        expectedVersion: p.expectedVersion,
        set: {
          status: p.outcome,
          updatedBy: msg.actorId,
          updatedAt: new Date(),
        },
        entity: "hearing",
      });

      await enqueue(tx, {
        topic: EVENTS.hearingConcluded,
        eventType: EVENTS.hearingConcluded,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { hearingId: p.hearingId, outcome: p.outcome },
      });
      await audit(tx, msg, "record_outcome", "court_hearing", p.hearingId);
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
