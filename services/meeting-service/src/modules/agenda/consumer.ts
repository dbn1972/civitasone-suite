/**
 * Agenda module — SQS / RabbitMQ consumer handlers (CQRS write side).
 *
 * Each handler follows the strict order mandated by steering:
 *   1. `markProcessed(tx, msg.messageId)` FIRST — idempotency guard (skip if already seen).
 *   2. Business write inside the SAME `db.transaction()`.
 *   3. `enqueue(tx, event)` domain + audit events into the transactional outbox (same tx).
 *   4. Cache invalidation AFTER commit (bounded TTL is the self-healing backstop).
 *
 * Pure domain rules live in domain.ts (`orderAgendaItems`, `assertSubmissionAllowed`,
 * `assertAgendaNotLocked`, `validateReorderBijection`, `applyReorder`, `buildCarryForward`);
 * this file wires them to persistence. Optimistic concurrency uses `versionedUpdate`
 * (WHERE version = $expected → 409 on conflict).
 *
 * Handlers are registered via `registerAgendaConsumers(register)` which the worker (task 19.1)
 * calls with its `registerConsumer` fn.
 *
 * _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_
 */
import { randomUUID } from "node:crypto";
import { and, eq, ne, gt, asc, isNotNull, notInArray, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import type { CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed, versionedUpdate, type DrizzleTx } from "../../shared/outbox.js";
import { httpError } from "../../shared/context.js";
import { COMMANDS, EVENTS, SERVICE } from "../../topics.js";
import { agendaItems } from "./schema.js";
import { meetings, meetingStateTransitions } from "../meeting-core/schema.js";
import {
  orderAgendaItems,
  validateReorderBijection,
  applyReorder,
  assertAgendaNotLocked,
  assertSubmissionAllowed,
  buildCarryForward,
  type ReorderEntry,
} from "./domain.js";

// ─── Message payload contracts (mirror topics.ts COMMANDS.agenda*) ───────────

interface AgendaSubmitPayload {
  agendaItemId: string;
  meetingId: string;
  tenantId: string;
  title: string;
  description?: string;
  outcomeType: string;
  durationMinutes?: number;
  presenterId?: string;
  category?: string;
  confidentialityLevel?: string;
  fileReference?: string;
  linkedDecisionIds?: string[];
}

interface AgendaPatch {
  title?: string;
  description?: string | null;
  outcomeType?: string;
  durationMinutes?: number;
  presenterId?: string | null;
  category?: string | null;
  confidentialityLevel?: string;
  fileReference?: string | null;
  status?: "proposed" | "accepted" | "deferred";
}

interface AgendaUpdatePayload {
  meetingId: string;
  agendaItemId: string;
  version: number;
  patch: AgendaPatch;
}

interface AgendaWithdrawPayload {
  meetingId: string;
  agendaItemId: string;
  version: number;
  reason?: string;
}

interface AgendaReorderPayload {
  meetingId: string;
  order: ReorderEntry[];
}

interface AgendaLockPayload {
  meetingId: string;
  version: number;
  locked: boolean;
}

// ─── Small persistence helpers ───────────────────────────────────────────────

/** The mutable-column subset used when inserting an agenda item (sequence assigned by ordering). */
interface AgendaItemFields {
  title: string;
  description: string | null;
  outcomeType: string;
  durationMinutes: number;
  presenterId: string | null;
  status: string;
  confidentialityLevel: string;
  category: string | null;
  linkedDecisionId: string | null;
  fileReference: string | null;
  submittedBy: string | null;
  submittedAt: Date | null;
}

/** Load the parent meeting (status + scheduling) for lock / deadline checks. */
async function getMeeting(tx: DrizzleTx, meetingId: string, tenantId: string) {
  const rows = await tx
    .select({
      id: meetings.id,
      status: meetings.status,
      scheduledAt: meetings.scheduledAt,
      committeeId: meetings.committeeId,
    })
    .from(meetings)
    .where(and(eq(meetings.id, meetingId), eq(meetings.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Load a single agenda item row (full) within the tx. */
async function getAgendaItem(tx: DrizzleTx, agendaItemId: string, tenantId: string) {
  const rows = await tx
    .select()
    .from(agendaItems)
    .where(and(eq(agendaItems.id, agendaItemId), eq(agendaItems.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Insert `item` onto `meetingId` and re-assign a canonical contiguous 1..N `sequence`
 * across all non-withdrawn items (Req 3.3, P26) via the pure `orderAgendaItems`. Existing
 * rows whose sequence changes are updated in primary-key order (deadlock prevention) with a
 * version bump. Returns the id of the inserted item.
 */
async function insertOrderedAgendaItem(
  tx: DrizzleTx,
  args: { id: string; tenantId: string; meetingId: string; actorId: string; item: AgendaItemFields },
): Promise<string> {
  const { id, tenantId, meetingId, actorId, item } = args;

  const existing = await tx
    .select({ id: agendaItems.id, category: agendaItems.category, sequence: agendaItems.sequence })
    .from(agendaItems)
    .where(
      and(
        eq(agendaItems.tenantId, tenantId),
        eq(agendaItems.meetingId, meetingId),
        ne(agendaItems.status, "withdrawn"),
      ),
    );

  const ordered = orderAgendaItems([
    ...existing.map((e) => ({ id: e.id, category: e.category, sequence: e.sequence })),
    { id, category: item.category, sequence: null },
  ]);
  const seqById = new Map(ordered.map((o) => [o.id, o.sequence]));

  await tx.insert(agendaItems).values({
    id,
    tenantId,
    meetingId,
    sequence: seqById.get(id) ?? existing.length + 1,
    title: item.title,
    description: item.description,
    outcomeType: item.outcomeType,
    durationMinutes: item.durationMinutes,
    presenterId: item.presenterId,
    status: item.status,
    confidentialityLevel: item.confidentialityLevel,
    category: item.category,
    linkedDecisionId: item.linkedDecisionId,
    fileReference: item.fileReference,
    submittedBy: item.submittedBy,
    submittedAt: item.submittedAt,
    createdBy: actorId,
    updatedBy: actorId,
  });

  const changed = existing
    .filter((e) => seqById.get(e.id) !== undefined && seqById.get(e.id) !== e.sequence)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const e of changed) {
    await tx
      .update(agendaItems)
      .set({
        sequence: seqById.get(e.id)!,
        updatedBy: actorId,
        updatedAt: new Date(),
        version: sql`${agendaItems.version} + 1`,
      })
      .where(and(eq(agendaItems.id, e.id), eq(agendaItems.tenantId, tenantId)));
  }

  return id;
}

/**
 * Find the next scheduled meeting of the same committee (for deferred-item carry-forward,
 * Req 3.6): the earliest future meeting (scheduled after `afterAt`) of `committeeId` that is
 * not the source meeting and not cancelled/closed/archived. Returns null when there is none.
 */
async function findNextCommitteeMeeting(
  tx: DrizzleTx,
  tenantId: string,
  committeeId: string,
  afterAt: Date | null,
  excludeMeetingId: string,
): Promise<{ id: string } | null> {
  const rows = await tx
    .select({ id: meetings.id })
    .from(meetings)
    .where(
      and(
        eq(meetings.tenantId, tenantId),
        eq(meetings.committeeId, committeeId),
        ne(meetings.id, excludeMeetingId),
        notInArray(meetings.status, ["cancelled", "closed", "archived"]),
        afterAt ? gt(meetings.scheduledAt, afterAt) : isNotNull(meetings.scheduledAt),
      ),
    )
    .orderBy(asc(meetings.scheduledAt))
    .limit(1);
  return rows[0] ?? null;
}

/** Emit a standard audit event into the outbox (steering: audit on every mutation). */
async function audit(
  tx: DrizzleTx,
  msg: CommandEnvelope,
  action: string,
  resourceType: string,
  resourceId: string,
  outcome: "success" | "failure" = "success",
  metadata?: Record<string, unknown>,
): Promise<void> {
  await enqueue(tx, {
    topic: "audit.event.record",
    eventType: "audit.event.record",
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: SERVICE, action, resourceType, resourceId, outcome, ...(metadata ? { metadata } : {}) },
  });
}

/** Best-effort agenda read-cache invalidation after commit. */
async function invalidateAgenda(tenantId: string, meetingId: string): Promise<void> {
  await cache.invalidate(cache.makeKey(tenantId, "agenda", meetingId));
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

/** agenda.submit — enforce lock + submission deadline, INSERT with canonical sequence (Req 3.1, 3.3, 3.5). */
async function handleAgendaSubmit(msg: CommandEnvelope): Promise<void> {
  const p = msg.payload as AgendaSubmitPayload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const meeting = await getMeeting(tx, p.meetingId, msg.tenantId);
    if (!meeting) return;
    assertAgendaNotLocked(meeting.status);
    assertSubmissionAllowed({ scheduledAt: meeting.scheduledAt, now: new Date() });

    await insertOrderedAgendaItem(tx, {
      id: p.agendaItemId,
      tenantId: msg.tenantId,
      meetingId: p.meetingId,
      actorId: msg.actorId,
      item: {
        title: p.title,
        description: p.description ?? null,
        outcomeType: p.outcomeType,
        durationMinutes: p.durationMinutes ?? 15,
        presenterId: p.presenterId ?? null,
        status: "proposed",
        confidentialityLevel: p.confidentialityLevel ?? "internal",
        category: p.category ?? null,
        linkedDecisionId: p.linkedDecisionIds?.[0] ?? null,
        fileReference: p.fileReference ?? null,
        submittedBy: msg.actorId,
        submittedAt: new Date(),
      },
    });

    await enqueue(tx, {
      topic: EVENTS.agendaItemSubmitted,
      eventType: EVENTS.agendaItemSubmitted,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: { meetingId: p.meetingId, agendaItemId: p.agendaItemId, outcomeType: p.outcomeType },
    });
    await audit(tx, msg, "submit", "agenda_item", p.agendaItemId);
  });
  await invalidateAgenda(msg.tenantId, p.meetingId);
}

/** agenda.update — patch fields; a `deferred` status auto carries the item forward (Req 3.1, 3.2, 3.6). */
async function handleAgendaUpdate(msg: CommandEnvelope): Promise<void> {
  const p = msg.payload as AgendaUpdatePayload;
  let carriedToMeetingId: string | null = null;

  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const item = await getAgendaItem(tx, p.agendaItemId, msg.tenantId);
    if (!item) return;
    const meeting = await getMeeting(tx, p.meetingId, msg.tenantId);
    if (!meeting) return;
    assertAgendaNotLocked(meeting.status);

    const patch = p.patch;
    const set = {
      updatedBy: msg.actorId,
      updatedAt: new Date(),
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.outcomeType !== undefined ? { outcomeType: patch.outcomeType } : {}),
      ...(patch.durationMinutes !== undefined ? { durationMinutes: patch.durationMinutes } : {}),
      ...(patch.presenterId !== undefined ? { presenterId: patch.presenterId } : {}),
      ...(patch.category !== undefined ? { category: patch.category } : {}),
      ...(patch.confidentialityLevel !== undefined ? { confidentialityLevel: patch.confidentialityLevel } : {}),
      ...(patch.fileReference !== undefined ? { fileReference: patch.fileReference } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
    } as PgUpdateSetSource<typeof agendaItems>;

    // Carry-forward on defer (Req 3.6): clone the item onto the next committee meeting.
    if (patch.status === "deferred" && meeting.committeeId) {
      const next = await findNextCommitteeMeeting(
        tx,
        msg.tenantId,
        meeting.committeeId,
        meeting.scheduledAt,
        p.meetingId,
      );
      if (next) {
        const plan = buildCarryForward(
          {
            id: item.id,
            tenantId: item.tenantId,
            title: item.title,
            description: item.description,
            outcomeType: item.outcomeType,
            durationMinutes: item.durationMinutes,
            presenterId: item.presenterId,
            confidentialityLevel: item.confidentialityLevel,
            category: item.category,
            linkedDecisionId: item.linkedDecisionId,
            fileReference: item.fileReference,
          },
          { nextMeetingId: next.id, actorId: msg.actorId },
        );
        const carriedId = randomUUID();
        await insertOrderedAgendaItem(tx, {
          id: carriedId,
          tenantId: msg.tenantId,
          meetingId: next.id,
          actorId: msg.actorId,
          item: {
            title: plan.next.title,
            description: plan.next.description,
            outcomeType: plan.next.outcomeType,
            durationMinutes: plan.next.durationMinutes,
            presenterId: plan.next.presenterId,
            status: plan.next.status,
            confidentialityLevel: plan.next.confidentialityLevel,
            category: plan.next.category,
            linkedDecisionId: plan.next.linkedDecisionId,
            fileReference: plan.next.fileReference,
            submittedBy: item.submittedBy,
            submittedAt: item.submittedAt,
          },
        });
        (set as Record<string, unknown>).deferredTo = carriedId;
        carriedToMeetingId = next.id;

        await enqueue(tx, {
          topic: EVENTS.agendaItemSubmitted,
          eventType: EVENTS.agendaItemSubmitted,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: { meetingId: next.id, agendaItemId: carriedId, outcomeType: plan.next.outcomeType },
        });
      }
    }

    await versionedUpdate(tx, agendaItems, {
      id: p.agendaItemId,
      tenantId: msg.tenantId,
      expectedVersion: p.version,
      set,
      entity: "agenda_item",
    });
    await audit(tx, msg, patch.status === "deferred" ? "defer" : "update", "agenda_item", p.agendaItemId);
  });

  await invalidateAgenda(msg.tenantId, p.meetingId);
  if (carriedToMeetingId) await invalidateAgenda(msg.tenantId, carriedToMeetingId);
}

/** agenda.withdraw — status → withdrawn (Req 3.2). Blocked while the agenda is locked. */
async function handleAgendaWithdraw(msg: CommandEnvelope): Promise<void> {
  const p = msg.payload as AgendaWithdrawPayload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const item = await getAgendaItem(tx, p.agendaItemId, msg.tenantId);
    if (!item) return;
    const meeting = await getMeeting(tx, p.meetingId, msg.tenantId);
    if (!meeting) return;
    assertAgendaNotLocked(meeting.status);

    await versionedUpdate(tx, agendaItems, {
      id: p.agendaItemId,
      tenantId: msg.tenantId,
      expectedVersion: p.version,
      set: { status: "withdrawn", updatedBy: msg.actorId, updatedAt: new Date() },
      entity: "agenda_item",
    });
    await audit(tx, msg, "withdraw", "agenda_item", p.agendaItemId, "success", p.reason ? { reason: p.reason } : undefined);
  });
  await invalidateAgenda(msg.tenantId, p.meetingId);
}

/** agenda.reorder — validate 1..N bijection + apply canonical sequences transactionally (Req 3.3, 3.4). */
async function handleAgendaReorder(msg: CommandEnvelope): Promise<void> {
  const p = msg.payload as AgendaReorderPayload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const meeting = await getMeeting(tx, p.meetingId, msg.tenantId);
    if (!meeting) return;
    assertAgendaNotLocked(meeting.status);

    validateReorderBijection(p.order);
    const canonical = applyReorder(p.order);

    const existing = await tx
      .select({ id: agendaItems.id })
      .from(agendaItems)
      .where(
        and(
          eq(agendaItems.tenantId, msg.tenantId),
          eq(agendaItems.meetingId, p.meetingId),
          ne(agendaItems.status, "withdrawn"),
        ),
      );
    const existingIds = new Set(existing.map((e) => e.id));
    if (canonical.length !== existingIds.size || !canonical.every((c) => existingIds.has(c.agendaItemId))) {
      throw httpError("VALIDATION_FAILED", "reorder payload does not match the meeting's agenda items", {
        meetingId: p.meetingId,
        expected: existingIds.size,
        received: canonical.length,
      });
    }

    // Deadlock prevention: apply updates in primary-key order.
    const sorted = [...canonical].sort((a, b) => (a.agendaItemId < b.agendaItemId ? -1 : 1));
    for (const entry of sorted) {
      await tx
        .update(agendaItems)
        .set({
          sequence: entry.sequence,
          updatedBy: msg.actorId,
          updatedAt: new Date(),
          version: sql`${agendaItems.version} + 1`,
        })
        .where(and(eq(agendaItems.id, entry.agendaItemId), eq(agendaItems.tenantId, msg.tenantId)));
    }
    await audit(tx, msg, "reorder", "meeting_agenda", p.meetingId);
  });
  await invalidateAgenda(msg.tenantId, p.meetingId);
}

/** agenda.lock — move the meeting into/out of `agenda_locked`, recording the state transition (Req 3.4). */
async function handleAgendaLock(msg: CommandEnvelope): Promise<void> {
  const p = msg.payload as AgendaLockPayload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const meeting = await getMeeting(tx, p.meetingId, msg.tenantId);
    if (!meeting) return;

    const toState = p.locked ? "agenda_locked" : "scheduled";
    if (meeting.status === toState) return; // idempotent no-op

    await versionedUpdate(tx, meetings, {
      id: p.meetingId,
      tenantId: msg.tenantId,
      expectedVersion: p.version,
      set: { status: toState, updatedBy: msg.actorId, updatedAt: new Date() },
      entity: "meeting",
    });
    await tx.insert(meetingStateTransitions).values({
      tenantId: msg.tenantId,
      meetingId: p.meetingId,
      fromState: meeting.status,
      toState,
      reason: p.locked ? "agenda_locked" : "agenda_unlocked",
      actorId: msg.actorId,
    });
    if (p.locked) {
      await enqueue(tx, {
        topic: EVENTS.agendaLocked,
        eventType: EVENTS.agendaLocked,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { meetingId: p.meetingId },
      });
    }
    await audit(tx, msg, p.locked ? "agenda_lock" : "agenda_unlock", "meeting", p.meetingId);
  });
  await invalidateAgenda(msg.tenantId, p.meetingId);
  await cache.invalidate(cache.makeKey(msg.tenantId, "meeting", p.meetingId));
}

// ─── Registration ─────────────────────────────────────────────────────────────

/** A topic → handler registrar (structurally compatible with the worker's `registerConsumer`). */
export type RegisterConsumer = <T = unknown>(
  topic: string,
  handler: (msg: CommandEnvelope<T>) => Promise<void>,
) => void;

/**
 * Register all agenda command consumers with the worker. Called from worker.ts (task 19.1)
 * with its `registerConsumer` function.
 */
export function registerAgendaConsumers(register: RegisterConsumer): void {
  register(COMMANDS.agendaItemSubmit, handleAgendaSubmit);
  register(COMMANDS.agendaItemUpdate, handleAgendaUpdate);
  register(COMMANDS.agendaItemWithdraw, handleAgendaWithdraw);
  register(COMMANDS.agendaReorder, handleAgendaReorder);
  register(COMMANDS.agendaLock, handleAgendaLock);
}
