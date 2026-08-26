/**
 * action-item module — SQS / RabbitMQ consumer handlers (CQRS write side, Req 9.x, 10.x).
 *
 * Every handler follows the mandatory order (steering: Concurrency & Data Integrity):
 *   1. ONE `db.transaction()` per message.
 *   2. `markProcessed(tx, msg.messageId)` FIRST — idempotency guard; if it returns false the
 *      message was already processed, so we skip (P30).
 *   3. Business write (INSERT, or optimistic-locked `versionedUpdate`).
 *   4. Emit domain EVENTS + an audit event into the transactional outbox (same tx, so
 *      "DB committed ⇒ event delivered" with no dual-write hole).
 *   5. AFTER commit, invalidate the read-through cache.
 *
 * Pure logic lives in domain.ts and is wired here to persistence:
 *   - `computeSlaHours`                    — assignment→deadline SLA window (Req 9.1).
 *   - `nextEscalationAt` / `resolveEscalationState` /
 *     `assertEscalationMonotonic` / `escalationTarget` — escalation chain (Req 9.5, 9.6, P20).
 *   - `assertDeadlineAfterMeetingStart`    — referential+temporal invariant (Req 9.1, P19).
 *   - `assertEvidenceBeforeVerification`   — evidence-before-verification (Req 9.7, P22).
 *
 * Notifications (Req 9.3, 9.5, 9.7): the assignee is notified on assignment (within the 10s SLA
 * — the notification is enqueued in the same tx and relayed immediately), the verifier (meeting
 * secretary) on evidence submission, and the escalation chain on escalation. No PII crosses this
 * boundary — only entity ids; notification-service resolves the delivery address.
 *
 * ATR auto-inclusion (Req 9.8): when an item escalates, `ensureAtrAgendaItem` makes sure an
 * "Action Taken Report" agenda item exists on the committee's next scheduled meeting so overdue
 * follow-up surfaces automatically.
 *
 * Permanent (non-retryable) violations — a missing anchor meeting/action item, a monotonicity
 * breach, verification without evidence — are re-thrown as `NonRetryableError` so they go to the
 * DLQ instead of retrying forever. Optimistic-lock conflicts surface as `VersionConflictError`
 * (409) from `versionedUpdate`.
 *
 * Registration: `registerActionItemConsumers(register)` maps each action-item COMMANDS topic to
 * its handler; worker.ts (task 19.1) passes its `registerConsumer` here.
 *
 * _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 10.1, 10.4_
 */
import { and, eq, ne, notInArray, gte, asc, sql } from "drizzle-orm";
import type { CommandEnvelope } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed, versionedUpdate, type DrizzleTx } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, SERVICE } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import { meetings } from "../meeting-core/schema.js";
import { agendaItems } from "../agenda/schema.js";
import { actionItems, actionProgress } from "./schema.js";
import {
  computeSlaHours,
  nextEscalationAt,
  escalationTarget,
  assertEscalationMonotonic,
  assertDeadlineAfterMeetingStart,
  assertEvidenceBeforeVerification,
  isSettledStatus,
} from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";
const ACTION_ITEM_RESOURCE = "action_item";

/** Meeting states in which no new ATR agenda item should be attached (already concluded). */
const CONCLUDED_MEETING_STATES = ["cancelled", "closed", "archived"] as const;

/** Marker title used to locate (and de-duplicate) the auto-generated ATR agenda item (Req 9.8). */
const ATR_AGENDA_TITLE = "Action Taken Report (ATR)";

// ─── Command payload contracts (mirror topics.ts + validators.ts) ──────────────

interface AssignPayload {
  actionItemId: string;
  meetingId: string;
  tenantId: string;
  decisionId?: string;
  agendaItemId?: string;
  description: string;
  assigneeId: string;
  deadline: string;
  priority: string;
  slaHours?: number;
  expectedEvidence?: string;
}

interface UpdatePatch {
  description?: string;
  assigneeId?: string;
  deadline?: string;
  priority?: string;
  slaHours?: number | null;
  expectedEvidence?: string | null;
}

interface UpdatePayload {
  actionItemId: string;
  tenantId: string;
  version: number;
  patch: UpdatePatch;
}

interface AcknowledgePayload {
  actionItemId: string;
  tenantId: string;
  version: number;
}

interface ProgressPayload {
  actionItemId: string;
  tenantId: string;
  updateText: string;
  percentage: number;
}

interface EvidencePayload {
  actionItemId: string;
  tenantId: string;
  evidenceUrl?: string;
  evidenceNote?: string;
}

interface VerifyPayload {
  actionItemId: string;
  tenantId: string;
  verifierId: string;
  verified: boolean;
  note?: string;
}

interface EscalatePayload {
  actionItemId: string;
  tenantId: string;
  toLevel: number;
}

// ─── Shared helpers ────────────────────────────────────────────────────────────

type MsgMeta = { tenantId: string; actorId: string; correlationId: string };

/** Emit an audit fact for every mutation (steering: audit on every mutation). */
async function audit(
  tx: DrizzleTx,
  msg: MsgMeta,
  action: string,
  resourceId: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: {
      service: SERVICE,
      action,
      resourceType: "action_item",
      resourceId,
      outcome: "success",
      ...(detail ? { detail } : {}),
    },
  });
}

/** Enqueue an in-app notification for a single recipient (no PII — entity ids only). */
async function notify(
  tx: DrizzleTx,
  msg: MsgMeta,
  eventType: string,
  recipientId: string,
  variables: Record<string, string>,
): Promise<void> {
  await enqueue(tx, {
    topic: NOTIFICATION_SEND,
    eventType: NOTIFICATION_SEND,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: buildNotificationPayload({
      eventType,
      recipient: recipientId,
      recipientId,
      channel: "in_app",
      variables,
    }),
  });
}

/** Best-effort read-cache invalidation for an action item (item key + meeting list + resource). */
async function invalidate(tenantId: string, actionItemId: string, meetingId: string | null): Promise<void> {
  await cache.invalidate(cache.makeKey(tenantId, ACTION_ITEM_RESOURCE, actionItemId));
  if (meetingId) await cache.invalidate(cache.makeKey(tenantId, ACTION_ITEM_RESOURCE, meetingId));
  await cache.invalidateResource(tenantId, ACTION_ITEM_RESOURCE);
}

/** Load an action-item row (scoped to tenant) within the tx, or null. */
async function loadActionItem(tx: DrizzleTx, actionItemId: string, tenantId: string) {
  const rows = await tx
    .select()
    .from(actionItems)
    .where(and(eq(actionItems.id, actionItemId), eq(actionItems.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Load a meeting row (scoped to tenant) within the tx, or null. */
async function loadMeeting(tx: DrizzleTx, meetingId: string, tenantId: string) {
  const rows = await tx
    .select()
    .from(meetings)
    .where(and(eq(meetings.id, meetingId), eq(meetings.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Ensure an "Action Taken Report" agenda item exists on the committee's next scheduled meeting so
 * overdue/escalated actions are automatically tabled for follow-up (Req 9.8). No-op when the
 * source meeting has no committee, when the committee has no upcoming (non-concluded) meeting, or
 * when an ATR item already exists on that meeting. The ATR item is inserted as an
 * information-outcome, arising-from-minutes agenda entry at the tail of the sequence.
 */
async function ensureAtrAgendaItem(
  tx: DrizzleTx,
  msg: MsgMeta,
  sourceMeeting: { id: string; committeeId: string | null },
): Promise<void> {
  if (!sourceMeeting.committeeId) return;

  const now = new Date();
  const upcoming = await tx
    .select({ id: meetings.id })
    .from(meetings)
    .where(
      and(
        eq(meetings.tenantId, msg.tenantId),
        eq(meetings.committeeId, sourceMeeting.committeeId),
        ne(meetings.id, sourceMeeting.id),
        notInArray(meetings.status, [...CONCLUDED_MEETING_STATES]),
        gte(meetings.scheduledAt, now),
      ),
    )
    .orderBy(asc(meetings.scheduledAt))
    .limit(1);
  const target = upcoming[0];
  if (!target) return;

  const existing = await tx
    .select({ id: agendaItems.id })
    .from(agendaItems)
    .where(
      and(
        eq(agendaItems.tenantId, msg.tenantId),
        eq(agendaItems.meetingId, target.id),
        eq(agendaItems.title, ATR_AGENDA_TITLE),
      ),
    )
    .limit(1);
  if (existing.length > 0) return;

  const maxSeq = await tx
    .select({ max: sql<number>`coalesce(max(${agendaItems.sequence}), 0)` })
    .from(agendaItems)
    .where(and(eq(agendaItems.tenantId, msg.tenantId), eq(agendaItems.meetingId, target.id)));
  const sequence = (maxSeq[0]?.max ?? 0) + 1;

  await tx.insert(agendaItems).values({
    tenantId: msg.tenantId,
    meetingId: target.id,
    sequence,
    title: ATR_AGENDA_TITLE,
    description: "Auto-generated: pending and overdue action items from prior meetings.",
    outcomeType: "information",
    status: "accepted",
    category: "arising_from_minutes",
    createdBy: msg.actorId,
    updatedBy: msg.actorId,
  });
}

// ─── Handlers ──────────────────────────────────────────────────────────────────

/**
 * action_item.assign → INSERT + set SLA/next-escalation window + notify assignee (Req 9.1, 9.3).
 * The deadline is validated against the meeting start (P19); a missing meeting or a deadline at or
 * before the meeting start is a permanent (DLQ) error.
 */
async function handleAssign(msg: CommandEnvelope<AssignPayload>): Promise<void> {
  const p = msg.payload;
  const assignedAt = new Date();
  const deadline = new Date(p.deadline);

  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    const meeting = await loadMeeting(tx, p.meetingId, msg.tenantId);
    if (!meeting) {
      throw new NonRetryableError(`meeting ${p.meetingId} not found for action item ${p.actionItemId}`);
    }
    // A concluded meeting (cancelled/closed/archived — the same vocabulary ensureAtrAgendaItem
    // already uses to skip picking one) must not accept new action-item assignments. Unguarded,
    // this let a meeting cancelled straight from "draft" (actual_start_at stays null forever, so
    // the temporal P19 guard below is vacuously true for ANY deadline) — or cancelled after
    // adjournment — still accept work against a meeting that, by the state machine, never
    // happened or is over.
    if ((CONCLUDED_MEETING_STATES as readonly string[]).includes(meeting.status)) {
      throw new NonRetryableError(
        `meeting ${p.meetingId} has concluded (status="${meeting.status}"); cannot assign new action items`,
      );
    }
    // P19 (Req 9.1): the deadline must fall after the meeting start.
    try {
      assertDeadlineAfterMeetingStart(deadline, meeting.actualStartAt);
    } catch (err) {
      throw new NonRetryableError(err instanceof HttpError ? err.message : String(err), err);
    }

    const slaHours = p.slaHours ?? computeSlaHours(assignedAt, deadline);
    const firstEscalation = nextEscalationAt(deadline, 0);

    await tx.insert(actionItems).values({
      id: p.actionItemId,
      tenantId: p.tenantId,
      meetingId: p.meetingId,
      decisionId: p.decisionId ?? null,
      agendaItemId: p.agendaItemId ?? null,
      description: p.description,
      assigneeId: p.assigneeId,
      deadline,
      priority: p.priority,
      slaHours,
      escalationLevel: 0,
      status: "assigned",
      nextEscalationAt: firstEscalation,
      createdBy: msg.actorId,
      updatedBy: msg.actorId,
    });

    await enqueue(tx, {
      topic: EVENTS.actionItemAssigned,
      eventType: EVENTS.actionItemAssigned,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: {
        actionItemId: p.actionItemId,
        meetingId: p.meetingId,
        assigneeId: p.assigneeId,
        deadline: deadline.toISOString(),
        priority: p.priority,
      },
    });
    // Req 9.3: notify the assignee (enqueued in-tx, relayed immediately → within the 10s SLA).
    await notify(tx, msg, EVENTS.actionItemAssigned, p.assigneeId, {
      actionItemId: p.actionItemId,
      deadline: deadline.toISOString(),
    });
    await audit(tx, msg, "assign", p.actionItemId, { assigneeId: p.assigneeId });
  });

  await invalidate(msg.tenantId, p.actionItemId, p.meetingId);
}

/**
 * action_item.update → optimistic-locked field patch (Req 9.1). When the deadline changes the SLA
 * window and the (un-fired) next-escalation trigger are recomputed so escalation stays consistent.
 */
async function handleUpdate(msg: CommandEnvelope<UpdatePayload>): Promise<void> {
  const p = msg.payload;

  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    const row = await loadActionItem(tx, p.actionItemId, msg.tenantId);
    if (!row) throw new NonRetryableError(`action item ${p.actionItemId} not found`);

    const set: Record<string, unknown> = { updatedBy: msg.actorId, updatedAt: new Date() };
    if (p.patch.description !== undefined) set.description = p.patch.description;
    if (p.patch.assigneeId !== undefined) set.assigneeId = p.patch.assigneeId;
    if (p.patch.priority !== undefined) set.priority = p.patch.priority;
    if (p.patch.slaHours !== undefined) set.slaHours = p.patch.slaHours;
    if (p.patch.deadline !== undefined) {
      const newDeadline = new Date(p.patch.deadline);
      set.deadline = newDeadline;
      // Recompute the SLA window (unless an explicit slaHours override was supplied in the patch).
      if (p.patch.slaHours === undefined) set.slaHours = computeSlaHours(row.createdAt, newDeadline);
      // Re-anchor the next (un-fired) escalation trigger to the new deadline at the current level.
      set.nextEscalationAt = nextEscalationAt(newDeadline, row.escalationLevel);
    }

    await versionedUpdate(tx, actionItems, {
      id: p.actionItemId,
      tenantId: msg.tenantId,
      expectedVersion: p.version,
      set,
      entity: "action_item",
    });
    await audit(tx, msg, "update", p.actionItemId);
  });

  await invalidate(msg.tenantId, p.actionItemId, null);
}

/**
 * action_item.acknowledge → record `acknowledged_at` and advance an unacknowledged item to
 * `acknowledged` (Req 9.4). Optimistic-locked on `version`.
 */
async function handleAcknowledge(msg: CommandEnvelope<AcknowledgePayload>): Promise<void> {
  const p = msg.payload;

  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    const row = await loadActionItem(tx, p.actionItemId, msg.tenantId);
    if (!row) throw new NonRetryableError(`action item ${p.actionItemId} not found`);
    // Self-scope (Req 9.4): only the item's assignee may acknowledge their own assignment (the
    // routes.ts RBAC comment documents this as a consumer-owned rule — this is that rule).
    if (msg.actorId !== row.assigneeId) {
      throw new NonRetryableError(`actor ${msg.actorId} is not the assignee of action item ${p.actionItemId}`);
    }

    const set: Record<string, unknown> = {
      acknowledgedAt: new Date(),
      updatedBy: msg.actorId,
      updatedAt: new Date(),
    };
    // Only advance state from the initial `assigned` — later states are not regressed.
    if (row.status === "assigned") set.status = "acknowledged";

    await versionedUpdate(tx, actionItems, {
      id: p.actionItemId,
      tenantId: msg.tenantId,
      expectedVersion: p.version,
      set,
      entity: "action_item",
    });
    await audit(tx, msg, "acknowledge", p.actionItemId);
  });

  await invalidate(msg.tenantId, p.actionItemId, null);
}

/**
 * action_item.progress → append an `action_progress` row (Req 9.x, 10.2) and advance an
 * early-state item to `in_progress`. The progress log is append-only; the status advance is a
 * light, guarded bump (never regresses a settled/verified item).
 */
async function handleProgress(msg: CommandEnvelope<ProgressPayload>): Promise<void> {
  const p = msg.payload;

  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    const row = await loadActionItem(tx, p.actionItemId, msg.tenantId);
    if (!row) throw new NonRetryableError(`action item ${p.actionItemId} not found`);
    // Self-scope (Req 9.x): only the item's assignee may log progress on their own assignment.
    if (msg.actorId !== row.assigneeId) {
      throw new NonRetryableError(`actor ${msg.actorId} is not the assignee of action item ${p.actionItemId}`);
    }

    await tx.insert(actionProgress).values({
      tenantId: msg.tenantId,
      actionItemId: p.actionItemId,
      updateText: p.updateText,
      percentage: p.percentage,
      updatedBy: msg.actorId,
    });

    // Advance assigned/acknowledged → in_progress (bump version to preserve the optimistic invariant).
    if (row.status === "assigned" || row.status === "acknowledged") {
      await tx
        .update(actionItems)
        .set({
          status: "in_progress",
          updatedBy: msg.actorId,
          updatedAt: new Date(),
          version: sql`${actionItems.version} + 1`,
        })
        .where(and(eq(actionItems.id, p.actionItemId), eq(actionItems.tenantId, msg.tenantId)));
    }
    await audit(tx, msg, "progress", p.actionItemId, { percentage: String(p.percentage) });
  });

  await invalidate(msg.tenantId, p.actionItemId, null);
}

/**
 * action_item.evidence → record completion evidence, move to `evidence_submitted`, and notify the
 * verifier (meeting secretary, else chairperson) for verification (Req 9.7). Optimistic-locked on
 * the row's current version.
 */
async function handleEvidence(msg: CommandEnvelope<EvidencePayload>): Promise<void> {
  const p = msg.payload;

  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    const row = await loadActionItem(tx, p.actionItemId, msg.tenantId);
    if (!row) throw new NonRetryableError(`action item ${p.actionItemId} not found`);
    // Terminal-status guard (Req 9.7): a settled item (completed/verified/withdrawn) must not
    // accept new evidence — unguarded, this silently un-completed a finished item while leaving
    // its stale completedAt/verifiedBy in place. Idempotent no-op for a redelivered/late message
    // that no longer applies, same house style as minutes/consumer.ts's applyMinutesOutcome.
    if (isSettledStatus(row.status)) return;
    // Self-scope (Req 9.7): only the item's assignee may submit evidence for their own assignment.
    if (msg.actorId !== row.assigneeId) {
      throw new NonRetryableError(`actor ${msg.actorId} is not the assignee of action item ${p.actionItemId}`);
    }

    await versionedUpdate(tx, actionItems, {
      id: p.actionItemId,
      tenantId: msg.tenantId,
      expectedVersion: row.version,
      set: {
        evidenceUrl: p.evidenceUrl ?? null,
        evidenceNote: p.evidenceNote ?? null,
        status: "evidence_submitted",
        updatedBy: msg.actorId,
        updatedAt: new Date(),
      },
      entity: "action_item",
    });

    await enqueue(tx, {
      topic: EVENTS.actionItemEvidenceSubmitted,
      eventType: EVENTS.actionItemEvidenceSubmitted,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: {
        actionItemId: p.actionItemId,
        meetingId: row.meetingId,
        ...(p.evidenceUrl ? { evidenceUrl: p.evidenceUrl } : {}),
      },
    });

    // Req 9.7: notify the verifier (secretary preferred, chairperson fallback) if resolvable.
    const meeting = await loadMeeting(tx, row.meetingId, msg.tenantId);
    const verifierId = meeting?.secretaryId ?? meeting?.chairpersonId ?? null;
    if (verifierId) {
      await notify(tx, msg, EVENTS.actionItemEvidenceSubmitted, verifierId, {
        actionItemId: p.actionItemId,
        meetingId: row.meetingId,
      });
    }
    await audit(tx, msg, "evidence", p.actionItemId);
  });

  await invalidate(msg.tenantId, p.actionItemId, null);
}

/**
 * action_item.verify → verify (`completed`) or reject (back to `in_progress`) submitted evidence
 * (Req 9.7). Verification requires evidence to be present (P22) — a verify without evidence is a
 * permanent (DLQ) error. Optimistic-locked on the row's current version.
 */
async function handleVerify(msg: CommandEnvelope<VerifyPayload>): Promise<void> {
  const p = msg.payload;

  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    const row = await loadActionItem(tx, p.actionItemId, msg.tenantId);
    if (!row) throw new NonRetryableError(`action item ${p.actionItemId} not found`);
    // Terminal-status guard (Req 9.7): a settled item must not be re-verified — that would
    // silently overwrite the ORIGINAL verifier's audit trail — nor reopened (reject branch) once
    // withdrawn. Idempotent no-op, same house style as the guards above.
    if (isSettledStatus(row.status)) return;

    if (p.verified) {
      // Self-verification guard (Req 9.7): the verifier must be a different person from the
      // assignee — an assignee signing off on their own work defeats the entire point of an
      // independent verification step. Bound to `msg.actorId` (the authenticated caller the
      // command envelope carries, set from `ctx.actorId` at the HTTP boundary) rather than the
      // client-supplied `verifierId` body field, which had no relationship check at all and let a
      // caller simply NAME an arbitrary verifier (e.g. the real secretary's id) while acting as
      // anyone. Silent no-op — mirrors the terminal-status guard above rather than throwing.
      if (msg.actorId === row.assigneeId) return;
      // P22 (Req 9.7): cannot verify without completion evidence.
      try {
        assertEvidenceBeforeVerification({ evidenceUrl: row.evidenceUrl, evidenceNote: row.evidenceNote });
      } catch (err) {
        throw new NonRetryableError(err instanceof HttpError ? err.message : String(err), err);
      }
      const completedAt = new Date();
      await versionedUpdate(tx, actionItems, {
        id: p.actionItemId,
        tenantId: msg.tenantId,
        expectedVersion: row.version,
        set: {
          verifiedBy: msg.actorId,
          verifiedAt: completedAt,
          status: "completed",
          completedAt,
          updatedBy: msg.actorId,
          updatedAt: completedAt,
        },
        entity: "action_item",
      });
      await enqueue(tx, {
        topic: EVENTS.actionItemCompleted,
        eventType: EVENTS.actionItemCompleted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { actionItemId: p.actionItemId, meetingId: row.meetingId, completedAt: completedAt.toISOString() },
      });
      await audit(tx, msg, "verify", p.actionItemId, { verified: "true", verifierId: msg.actorId });
    } else {
      // Rejected: return to the assignee for rework; evidence is retained for reference.
      await versionedUpdate(tx, actionItems, {
        id: p.actionItemId,
        tenantId: msg.tenantId,
        expectedVersion: row.version,
        set: { status: "in_progress", updatedBy: msg.actorId, updatedAt: new Date() },
        entity: "action_item",
      });
      // Notify the assignee that their evidence was returned.
      await notify(tx, msg, EVENTS.actionItemEvidenceSubmitted, row.assigneeId, {
        actionItemId: p.actionItemId,
        meetingId: row.meetingId,
      });
      await audit(tx, msg, "verify", p.actionItemId, { verified: "false", verifierId: msg.actorId });
    }
  });

  await invalidate(msg.tenantId, p.actionItemId, null);
}

/**
 * action_item.escalate → advance the escalation level (monotonic, P20), re-anchor the next
 * trigger, notify the chain rung + assignee, and surface the item as an ATR on the committee's
 * next meeting (Req 9.5, 9.6, 9.8). Optimistic-locked on the row's current version.
 */
async function handleEscalate(msg: CommandEnvelope<EscalatePayload>): Promise<void> {
  const p = msg.payload;

  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    const row = await loadActionItem(tx, p.actionItemId, msg.tenantId);
    if (!row) throw new NonRetryableError(`action item ${p.actionItemId} not found`);

    // P20: escalation level may only increase — a downgrade is a permanent (DLQ) error.
    try {
      assertEscalationMonotonic(row.escalationLevel, p.toLevel);
    } catch (err) {
      throw new NonRetryableError(err instanceof HttpError ? err.message : String(err), err);
    }

    const target = escalationTarget(p.toLevel);
    const upcomingTrigger = nextEscalationAt(row.deadline, p.toLevel);
    const now = new Date();

    await versionedUpdate(tx, actionItems, {
      id: p.actionItemId,
      tenantId: msg.tenantId,
      expectedVersion: row.version,
      set: {
        escalationLevel: p.toLevel,
        status: "escalated",
        overdueAt: row.overdueAt ?? row.deadline,
        nextEscalationAt: upcomingTrigger,
        updatedBy: msg.actorId,
        updatedAt: now,
      },
      entity: "action_item",
    });

    // Resolve the chain recipient we can name: chairperson at level 3, else the meeting secretary
    // (the coordinating officer). The reporting officer / department head is resolved downstream
    // from the assignee via the event's `notify` role (hrms-driven routing).
    const meeting = await loadMeeting(tx, row.meetingId, msg.tenantId);
    const notifyIds: string[] = [];
    if (target === "chairperson" && meeting?.chairpersonId) notifyIds.push(meeting.chairpersonId);
    else if (meeting?.secretaryId) notifyIds.push(meeting.secretaryId);

    await enqueue(tx, {
      topic: EVENTS.actionItemEscalated,
      eventType: EVENTS.actionItemEscalated,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: {
        actionItemId: p.actionItemId,
        meetingId: row.meetingId,
        assigneeId: row.assigneeId,
        toLevel: p.toLevel,
        ...(target ? { notify: target } : {}),
        notifyIds,
      },
    });

    // Notify the assignee and each resolvable chain recipient (Req 9.5).
    await notify(tx, msg, EVENTS.actionItemEscalated, row.assigneeId, {
      actionItemId: p.actionItemId,
      toLevel: String(p.toLevel),
    });
    for (const recipientId of notifyIds) {
      await notify(tx, msg, EVENTS.actionItemEscalated, recipientId, {
        actionItemId: p.actionItemId,
        toLevel: String(p.toLevel),
      });
    }

    // Req 9.8: table the overdue item as an ATR on the committee's next scheduled meeting.
    if (meeting) {
      await ensureAtrAgendaItem(tx, msg, { id: meeting.id, committeeId: meeting.committeeId });
    }

    await audit(tx, msg, "escalate", p.actionItemId, { toLevel: String(p.toLevel) });
  });

  await invalidate(msg.tenantId, p.actionItemId, null);
}

// ─── Registration ──────────────────────────────────────────────────────────────

/** A single-topic consumer handler (matches worker.ts `ConsumerHandler`). */
type ConsumerHandler<T = unknown> = (msg: CommandEnvelope<T>) => Promise<void>;
/** worker.ts `registerConsumer` shape — kept structural to avoid importing the worker. */
type RegisterConsumer = <T>(topic: string, handler: ConsumerHandler<T>) => void;

/**
 * Register every action-item command handler. worker.ts (task 19.1) calls this with its
 * `registerConsumer`, wiring the action-item COMMANDS topics to the handlers above.
 */
export function registerActionItemConsumers(register: RegisterConsumer): void {
  register(COMMANDS.actionItemAssign, handleAssign);
  register(COMMANDS.actionItemUpdate, handleUpdate);
  register(COMMANDS.actionItemAcknowledge, handleAcknowledge);
  register(COMMANDS.actionItemProgress, handleProgress);
  register(COMMANDS.actionItemEvidence, handleEvidence);
  register(COMMANDS.actionItemVerify, handleVerify);
  register(COMMANDS.actionItemEscalate, handleEscalate);
}
