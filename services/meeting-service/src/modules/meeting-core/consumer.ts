/**
 * meeting-core — SQS / RabbitMQ consumer handlers (CQRS write side, Req 1.1–1.7, 14.5).
 *
 * Every handler follows the strict order mandated by steering (Concurrency & Data Integrity):
 *   1. ONE `db.transaction()` per message.
 *   2. `markProcessed(tx, msg.messageId)` FIRST — idempotency guard; if it returns false the
 *      message was already processed, so we skip (P30).
 *   3. Business write (INSERT, or optimistic-locked `versionedUpdate`).
 *   4. Emit domain EVENTS + an audit event into the transactional outbox (same tx, so
 *      "DB committed ⇒ event delivered" with no dual-write hole).
 *   5. AFTER commit, invalidate the read-through cache.
 *
 * Pure lifecycle logic lives in domain.ts (`assertTransition`, `isTerminal`,
 * `stateRequiresActualStart`, `computeFinancialYear`, `nextMeetingSequence`,
 * `generateMeetingNumber`); this file wires it to persistence. Permanent (non-retryable)
 * violations — an illegal transition, an unknown state, a malformed message — are re-thrown
 * as `NonRetryableError` so they go straight to the DLQ instead of being retried forever.
 * Optimistic-lock conflicts surface as `VersionConflictError` (409) from `versionedUpdate`.
 *
 * Registration: `registerMeetingCoreConsumers(register)` maps each meeting-core COMMANDS
 * topic to its handler; worker.ts (task 19.1) passes its `registerConsumer` here.
 *
 * _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 14.5_
 */
import { randomUUID } from "node:crypto";
import { and, eq, isNull, count } from "drizzle-orm";
import type { CommandEnvelope } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed, versionedUpdate, type DrizzleTx } from "../../shared/outbox.js";
import { HttpError } from "../../shared/context.js";
import { COMMANDS, EVENTS, SERVICE } from "../../topics.js";
import { meetings, meetingSeries, meetingStateTransitions, meetingTypes } from "./schema.js";
import { agendaItems } from "../agenda/schema.js";
import { committees, committeeMembers } from "../committee/schema.js";
import {
  assertTransition,
  computeFinancialYear,
  generateMeetingNumber,
  isMeetingState,
  nextMeetingSequence,
  type MeetingState,
} from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";
const CACHE_RESOURCE = "meeting";
const SERIES_RESOURCE = "meeting_series";
const MEETING_TYPE_RESOURCE = "meeting_type";
/** Upper bound on instances materialised in a single series-generate (runaway guard). */
const MAX_SERIES_INSTANCES = 200;

// ─── Command payload contracts (mirror topics.ts JSDoc) ────────────────────────

interface MeetingCreatePayload {
  id: string;
  tenantId: string;
  title: string;
  type: string;
  description?: string;
  scheduledAt: string;
  durationMinutes: number;
  committeeId?: string;
  chairpersonId: string;
  secretaryId: string;
  convenerId?: string;
  venue?: string;
  vcEnabled?: boolean;
  confidentialityLevel?: string;
  fileReference?: string;
}

interface MeetingPatch {
  title?: string;
  description?: string | null;
  type?: string;
  committeeId?: string | null;
  chairpersonId?: string;
  secretaryId?: string;
  convenerId?: string | null;
  scheduledAt?: string;
  durationMinutes?: number;
  venue?: string | null;
  vcEnabled?: boolean;
  vcLink?: string | null;
  confidentialityLevel?: string;
  fileReference?: string | null;
}

interface MeetingUpdatePayload {
  meetingId: string;
  version: number;
  patch: MeetingPatch;
}

interface MeetingTransitionPayload {
  meetingId: string;
  version: number;
  to: string;
  reason?: string;
  nextMeetingDate?: string;
}

interface MeetingCancelPayload {
  meetingId: string;
  version: number;
  reason: string;
}

interface SeriesCreatePayload {
  id: string;
  tenantId: string;
  committeeId: string;
  pattern: string;
  startDate: string;
  endDate?: string;
  dayOfWeek?: number;
  dayOfMonth?: number;
  timeOfDay?: string;
  durationMinutes?: number;
}

interface SeriesUpdatePayload {
  seriesId: string;
  version: number;
  patch: {
    pattern?: string;
    endDate?: string | null;
    dayOfWeek?: number | null;
    dayOfMonth?: number | null;
    timeOfDay?: string | null;
    durationMinutes?: number;
    isActive?: boolean;
  };
}

interface SeriesGeneratePayload {
  seriesId: string;
  upToDate: string;
}

interface MeetingTypeCreatePayload {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description?: string;
  templateConfig?: Record<string, unknown>;
  isStatutory?: boolean;
  frequency?: string;
}

interface MeetingTypeUpdatePayload {
  meetingTypeId: string;
  version: number;
  patch: {
    name?: string;
    description?: string | null;
    templateConfig?: Record<string, unknown> | null;
    isStatutory?: boolean;
    frequency?: string | null;
  };
}

// ─── Shared helpers ────────────────────────────────────────────────────────────

type MsgMeta = { tenantId: string; actorId: string; correlationId: string };

/** Emit an audit fact for every mutation (steering: audit on every mutation). */
async function audit(
  tx: DrizzleTx,
  msg: MsgMeta,
  action: string,
  resourceType: string,
  resourceId: string,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: SERVICE, action, resourceType, resourceId, outcome: "success" },
  });
}

/** Convert a validation `HttpError` into a permanent DLQ error (never retry a bad transition). */
function asPermanent(err: unknown): never {
  if (err instanceof HttpError) throw new NonRetryableError(err.message, err);
  throw err;
}

/** Load the parent meeting row (full) within the tx. */
async function loadMeeting(tx: DrizzleTx, meetingId: string, tenantId: string) {
  const rows = await tx
    .select()
    .from(meetings)
    .where(and(eq(meetings.id, meetingId), eq(meetings.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Count non-withdrawn agenda items attached to a meeting (draft→scheduled prerequisite, Req 1.3). */
async function countAgendaItems(tx: DrizzleTx, meetingId: string, tenantId: string): Promise<number> {
  const rows = await tx
    .select({ n: count() })
    .from(agendaItems)
    .where(and(eq(agendaItems.meetingId, meetingId), eq(agendaItems.tenantId, tenantId)));
  return Number(rows[0]?.n ?? 0);
}

/** Extract the trailing numeric sequence from a meeting number like "FC/2025-26/007" → 7. */
function parseMeetingSequence(meetingNumber: string | null): number | null {
  if (!meetingNumber) return null;
  const tail = meetingNumber.split("/").pop() ?? "";
  const n = Number.parseInt(tail, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Assign a sequential meeting number scoped to (committee, financial year) (Req 1.2). Reads the
 * numbers already issued in the same scope, computes the next sequence via the pure
 * `nextMeetingSequence`, and formats it via `generateMeetingNumber`. The DB UNIQUE constraint on
 * (tenant, committee, meeting_number) is the ultimate guard against a concurrent race.
 */
async function computeMeetingNumber(
  tx: DrizzleTx,
  args: { tenantId: string; committeeId: string | null; scheduledAt: Date },
): Promise<{ meetingNumber: string; financialYear: string }> {
  const financialYear = computeFinancialYear(args.scheduledAt);

  const scopeFilter = args.committeeId
    ? eq(meetings.committeeId, args.committeeId)
    : isNull(meetings.committeeId);
  const rows = await tx
    .select({ meetingNumber: meetings.meetingNumber })
    .from(meetings)
    .where(and(eq(meetings.tenantId, args.tenantId), eq(meetings.financialYear, financialYear), scopeFilter));

  const sequences = rows
    .map((r) => parseMeetingSequence(r.meetingNumber))
    .filter((n): n is number => n !== null);
  const sequence = nextMeetingSequence(sequences);

  let committeeCode: string | null = null;
  if (args.committeeId) {
    const c = await tx
      .select({ code: committees.code })
      .from(committees)
      .where(and(eq(committees.id, args.committeeId), eq(committees.tenantId, args.tenantId)))
      .limit(1);
    committeeCode = c[0]?.code ?? null;
  }

  return { meetingNumber: generateMeetingNumber({ committeeCode, financialYear, sequence }), financialYear };
}

/** Best-effort read-cache invalidation for a resource (single key + resource list) after commit. */
async function invalidate(tenantId: string, resource: string, id: string): Promise<void> {
  await cache.invalidate(cache.makeKey(tenantId, resource, id));
  await cache.invalidateResource(tenantId, resource);
}

/** Coerce a recognised meeting-state string or reject the message permanently. */
function requireMeetingState(value: string): MeetingState {
  if (!isMeetingState(value)) {
    throw new NonRetryableError(`unknown meeting state "${value}"`);
  }
  return value;
}

// ─── Series instance-date generation (pure, Req 14.5) ────────────────────────────

const MS_PER_DAY = 86_400_000;

/** Advance a UTC date by one step of the recurrence `pattern`. */
function advance(d: Date, pattern: string): Date {
  const next = new Date(d.getTime());
  switch (pattern) {
    case "weekly":
      next.setUTCDate(next.getUTCDate() + 7);
      break;
    case "fortnightly":
      next.setUTCDate(next.getUTCDate() + 14);
      break;
    case "monthly":
      next.setUTCMonth(next.getUTCMonth() + 1);
      break;
    case "quarterly":
      next.setUTCMonth(next.getUTCMonth() + 3);
      break;
    case "half_yearly":
      next.setUTCMonth(next.getUTCMonth() + 6);
      break;
    case "annual":
      next.setUTCFullYear(next.getUTCFullYear() + 1);
      break;
    default:
      throw new NonRetryableError(`unknown series pattern "${pattern}"`);
  }
  return next;
}

/**
 * Materialise the recurrence dates (ISO `YYYY-MM-DD`) for a series: starting at `fromIso`,
 * stepping by `pattern`, up to and including `upToIso`, bounded by an optional `endIso` and a
 * hard `MAX_SERIES_INSTANCES` cap. Returns `[]` when the window is empty.
 */
function generateInstanceDates(args: {
  pattern: string;
  fromIso: string;
  upToIso: string;
  endIso: string | null;
}): string[] {
  const { pattern, fromIso, upToIso, endIso } = args;
  const upTo = Date.parse(`${upToIso}T00:00:00Z`);
  const end = endIso ? Date.parse(`${endIso}T00:00:00Z`) : Number.POSITIVE_INFINITY;
  const ceiling = Math.min(upTo, end);

  const out: string[] = [];
  let cursor = new Date(Date.parse(`${fromIso}T00:00:00Z`));
  while (cursor.getTime() <= ceiling && out.length < MAX_SERIES_INSTANCES) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor = advance(cursor, pattern);
  }
  return out;
}

/** Combine an ISO date + optional `HH:MM` time-of-day into a timestamptz (UTC). */
function toScheduledAt(dateIso: string, timeOfDay: string | null): Date {
  const time = timeOfDay && /^([01]\d|2[0-3]):[0-5]\d$/.test(timeOfDay) ? timeOfDay : "00:00";
  return new Date(`${dateIso}T${time}:00Z`);
}

// ─── Handlers ──────────────────────────────────────────────────────────────────

/** meeting.create → INSERT draft meeting + sequential meeting number + emit `meeting.created` (Req 1.2). */
async function handleMeetingCreate(msg: CommandEnvelope<MeetingCreatePayload>): Promise<void> {
  const p = msg.payload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    const scheduledAt = new Date(p.scheduledAt);
    const { meetingNumber, financialYear } = await computeMeetingNumber(tx, {
      tenantId: p.tenantId,
      committeeId: p.committeeId ?? null,
      scheduledAt,
    });

    await tx.insert(meetings).values({
      id: p.id,
      tenantId: p.tenantId,
      type: p.type,
      title: p.title,
      description: p.description ?? null,
      status: "draft",
      committeeId: p.committeeId ?? null,
      chairpersonId: p.chairpersonId,
      secretaryId: p.secretaryId,
      convenerId: p.convenerId ?? null,
      scheduledAt,
      durationMinutes: p.durationMinutes,
      venue: p.venue ?? null,
      vcEnabled: p.vcEnabled ?? false,
      confidentialityLevel: p.confidentialityLevel ?? "internal",
      fileReference: p.fileReference ?? null,
      meetingNumber,
      financialYear,
      createdBy: msg.actorId,
      updatedBy: msg.actorId,
    });

    await enqueue(tx, {
      topic: EVENTS.meetingCreated,
      eventType: EVENTS.meetingCreated,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: { meetingId: p.id, type: p.type, committeeId: p.committeeId ?? null, status: "draft" },
    });
    await audit(tx, msg, "create", "meeting", p.id);
  });
  await invalidate(msg.tenantId, CACHE_RESOURCE, p.id);
}

/** meeting.update → optimistic-locked field patch (status is NOT patchable here) + emit `meeting.updated`. */
async function handleMeetingUpdate(msg: CommandEnvelope<MeetingUpdatePayload>): Promise<void> {
  const p = msg.payload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const meeting = await loadMeeting(tx, p.meetingId, msg.tenantId);
    if (!meeting) return;

    const set: Record<string, unknown> = { updatedBy: msg.actorId, updatedAt: new Date() };
    for (const [k, v] of Object.entries(p.patch)) {
      if (v === undefined) continue;
      set[k] = k === "scheduledAt" && typeof v === "string" ? new Date(v) : v;
    }

    await versionedUpdate(tx, meetings, {
      id: p.meetingId,
      tenantId: msg.tenantId,
      expectedVersion: p.version,
      set,
      entity: "meeting",
    });
    await audit(tx, msg, "update", "meeting", p.meetingId);
  });
  await invalidate(msg.tenantId, CACHE_RESOURCE, p.meetingId);
}

/** Shared state-change writer: validate transition, apply derived fields, log transition, emit event. */
async function applyTransition(
  tx: DrizzleTx,
  msg: MsgMeta & { messageId: string },
  args: {
    meeting: typeof meetings.$inferSelect;
    to: MeetingState;
    expectedVersion: number;
    reason: string | null;
    nextMeetingDate: string | null;
  },
): Promise<void> {
  const { meeting, to, expectedVersion, reason, nextMeetingDate } = args;
  const from = requireMeetingState(meeting.status);
  const now = new Date();

  // Gather agenda count only when it matters (draft→scheduled prerequisite, Req 1.3).
  const agendaItemCount =
    from === "draft" && to === "scheduled"
      ? await countAgendaItems(tx, meeting.id, meeting.tenantId)
      : undefined;

  try {
    // Conditional spread keeps this compatible with exactOptionalPropertyTypes
    // (never assign an explicit `undefined` to an optional field).
    assertTransition(from, to, {
      now,
      chairpersonId: meeting.chairpersonId,
      scheduledAt: meeting.scheduledAt,
      quorumEstablished: meeting.quorumEstablished,
      adjournmentReason: to === "adjourned" ? reason : meeting.adjournmentReason,
      ...(agendaItemCount !== undefined ? { agendaItemCount } : {}),
    });
  } catch (err) {
    asPermanent(err);
  }

  // Derived fields per target state.
  const set: Record<string, unknown> = { status: to, updatedBy: msg.actorId, updatedAt: now };
  if (to === "scheduled" && !meeting.meetingNumber) {
    const { meetingNumber, financialYear } = await computeMeetingNumber(tx, {
      tenantId: meeting.tenantId,
      committeeId: meeting.committeeId,
      scheduledAt: meeting.scheduledAt ?? now,
    });
    set.meetingNumber = meetingNumber;
    set.financialYear = financialYear;
  }
  if (to === "in_progress" && !meeting.actualStartAt) set.actualStartAt = now;
  if (to === "minutes_pending" && !meeting.actualEndAt) set.actualEndAt = now;
  if (to === "adjourned") {
    set.adjournmentReason = reason;
    if (nextMeetingDate) set.nextMeetingDate = new Date(nextMeetingDate);
  }

  await versionedUpdate(tx, meetings, {
    id: meeting.id,
    tenantId: meeting.tenantId,
    expectedVersion,
    set,
    entity: "meeting",
  });

  await tx.insert(meetingStateTransitions).values({
    tenantId: meeting.tenantId,
    meetingId: meeting.id,
    fromState: from,
    toState: to,
    reason,
    actorId: msg.actorId,
  });

  const actualStartSet = set.actualStartAt as Date | undefined;
  await emitTransitionEvent(tx, msg, {
    meeting,
    to,
    now,
    reason,
    nextMeetingDate,
    ...(actualStartSet ? { actualStartSet } : {}),
  });
}

/** Emit the domain event that corresponds to the meeting's new state (Req 1.7 downstream fan-out). */
async function emitTransitionEvent(
  tx: DrizzleTx,
  msg: MsgMeta,
  args: {
    meeting: typeof meetings.$inferSelect;
    to: MeetingState;
    now: Date;
    reason: string | null;
    nextMeetingDate: string | null;
    actualStartSet?: Date;
  },
): Promise<void> {
  const { meeting, to, now, reason, nextMeetingDate } = args;
  const meetingId = meeting.id;
  const base = {
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
  };

  const emit = (topic: string, payload: Record<string, unknown>) =>
    enqueue(tx, { topic, eventType: topic, ...base, payload });

  switch (to) {
    case "scheduled":
      await emit(EVENTS.meetingScheduled, { meetingId, scheduledAt: meeting.scheduledAt });
      break;
    case "agenda_locked":
      await emit(EVENTS.meetingAgendaLocked, { meetingId });
      break;
    case "in_progress":
      await emit(EVENTS.meetingStarted, {
        meetingId,
        actualStartAt: meeting.actualStartAt ?? args.actualStartSet ?? now,
        quorumEstablished: true,
      });
      break;
    case "adjourned":
      await emit(EVENTS.meetingAdjourned, {
        meetingId,
        adjournmentReason: reason,
        ...(nextMeetingDate ? { nextMeetingDate } : {}),
        carriedForwardItemIds: [],
      });
      break;
    case "minutes_pending":
      await emit(EVENTS.meetingCompleted, { meetingId, actualEndAt: meeting.actualEndAt ?? now });
      break;
    case "closed":
      await emit(EVENTS.meetingClosed, { meetingId });
      break;
    case "archived":
      await emit(EVENTS.meetingArchived, { meetingId });
      break;
    case "cancelled":
      await emit(EVENTS.meetingCancelled, { meetingId, reason });
      break;
    default:
      // draft (reopen) / minutes_approved have no dedicated meeting-core event.
      break;
  }
}

/** meeting.transition → validate + UPDATE status + INSERT state-transition row + emit event (Req 1.3–1.7). */
async function handleMeetingTransition(msg: CommandEnvelope<MeetingTransitionPayload>): Promise<void> {
  const p = msg.payload;
  const to = requireMeetingState(p.to);
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const meeting = await loadMeeting(tx, p.meetingId, msg.tenantId);
    if (!meeting) return;

    await applyTransition(tx, { ...msg }, {
      meeting,
      to,
      expectedVersion: p.version,
      reason: p.reason ?? null,
      nextMeetingDate: p.nextMeetingDate ?? null,
    });
    await audit(tx, msg, `transition:${to}`, "meeting", p.meetingId);
  });
  await invalidate(msg.tenantId, CACHE_RESOURCE, p.meetingId);
}

/** meeting.cancel → soft-cancel to the terminal `cancelled` state (Req 1.6, 1.7). */
async function handleMeetingCancel(msg: CommandEnvelope<MeetingCancelPayload>): Promise<void> {
  const p = msg.payload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const meeting = await loadMeeting(tx, p.meetingId, msg.tenantId);
    if (!meeting) return;

    await applyTransition(tx, { ...msg }, {
      meeting,
      to: "cancelled",
      expectedVersion: p.version,
      reason: p.reason,
      nextMeetingDate: null,
    });
    await audit(tx, msg, "cancel", "meeting", p.meetingId);
  });
  await invalidate(msg.tenantId, CACHE_RESOURCE, p.meetingId);
}

/** meeting.series.create → INSERT recurring pattern + emit `meeting.series.created` (Req 14.5). */
async function handleSeriesCreate(msg: CommandEnvelope<SeriesCreatePayload>): Promise<void> {
  const p = msg.payload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    await tx.insert(meetingSeries).values({
      id: p.id,
      tenantId: p.tenantId,
      committeeId: p.committeeId,
      pattern: p.pattern,
      dayOfWeek: p.dayOfWeek ?? null,
      dayOfMonth: p.dayOfMonth ?? null,
      timeOfDay: p.timeOfDay ?? null,
      durationMinutes: p.durationMinutes ?? 60,
      startDate: p.startDate,
      endDate: p.endDate ?? null,
      nextInstanceDate: p.startDate,
      isActive: true,
      createdBy: msg.actorId,
      updatedBy: msg.actorId,
    });
    await enqueue(tx, {
      topic: EVENTS.meetingSeriesCreated,
      eventType: EVENTS.meetingSeriesCreated,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: { seriesId: p.id, committeeId: p.committeeId, pattern: p.pattern, startDate: p.startDate },
    });
    await audit(tx, msg, "create", "meeting_series", p.id);
  });
  await invalidate(msg.tenantId, SERIES_RESOURCE, p.id);
}

/** meeting.series.update → optimistic-locked patch + emit `meeting.series.updated`. */
async function handleSeriesUpdate(msg: CommandEnvelope<SeriesUpdatePayload>): Promise<void> {
  const p = msg.payload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const set: Record<string, unknown> = { updatedBy: msg.actorId, updatedAt: new Date() };
    for (const [k, v] of Object.entries(p.patch)) {
      if (v !== undefined) set[k] = v;
    }
    await versionedUpdate(tx, meetingSeries, {
      id: p.seriesId,
      tenantId: msg.tenantId,
      expectedVersion: p.version,
      set,
      entity: "meeting_series",
    });
    await enqueue(tx, {
      topic: EVENTS.meetingSeriesUpdated,
      eventType: EVENTS.meetingSeriesUpdated,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: { seriesId: p.seriesId },
    });
    await audit(tx, msg, "update", "meeting_series", p.seriesId);
  });
  await invalidate(msg.tenantId, SERIES_RESOURCE, p.seriesId);
}

/**
 * meeting.series.generate → materialise `draft` meeting instances from the series pattern up to
 * `upToDate`, carrying the committee's chairperson/secretary forward onto each instance (Req 14.5).
 * Advances the series `nextInstanceDate` past the last generated date so a re-run is incremental
 * (and, with `markProcessed`, a redelivery of the SAME message is a no-op — P30).
 */
async function handleSeriesGenerate(msg: CommandEnvelope<SeriesGeneratePayload>): Promise<void> {
  const p = msg.payload;
  const generatedMeetingIds: string[] = [];
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;

    const rows = await tx
      .select()
      .from(meetingSeries)
      .where(and(eq(meetingSeries.id, p.seriesId), eq(meetingSeries.tenantId, msg.tenantId)))
      .limit(1);
    const series = rows[0];
    if (!series || !series.isActive) return;

    const fromIso = series.nextInstanceDate ?? series.startDate;
    const dates = generateInstanceDates({
      pattern: series.pattern,
      fromIso,
      upToIso: p.upToDate,
      endIso: series.endDate ?? null,
    });
    if (dates.length === 0) return;

    // Committee membership carry-forward: resolve chairperson/secretary from the active roster.
    const members = await tx
      .select({ memberId: committeeMembers.memberId, role: committeeMembers.role })
      .from(committeeMembers)
      .where(
        and(
          eq(committeeMembers.tenantId, msg.tenantId),
          eq(committeeMembers.committeeId, series.committeeId),
          eq(committeeMembers.status, "active"),
        ),
      );
    const chairpersonId = members.find((m) => m.role === "chairperson")?.memberId ?? null;
    const secretaryId = members.find((m) => m.role === "secretary")?.memberId ?? null;

    const committeeRow = await tx
      .select({ name: committees.name })
      .from(committees)
      .where(and(eq(committees.id, series.committeeId), eq(committees.tenantId, msg.tenantId)))
      .limit(1);
    const committeeName = committeeRow[0]?.name ?? "Committee";

    for (const dateIso of dates) {
      const meetingId = randomUUID();
      const scheduledAt = toScheduledAt(dateIso, series.timeOfDay);
      await tx.insert(meetings).values({
        id: meetingId,
        tenantId: msg.tenantId,
        type: "committee",
        title: `${committeeName} — ${dateIso}`,
        status: "draft",
        committeeId: series.committeeId,
        chairpersonId,
        secretaryId,
        scheduledAt,
        durationMinutes: series.durationMinutes,
        seriesId: series.id,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      generatedMeetingIds.push(meetingId);
      await enqueue(tx, {
        topic: EVENTS.meetingCreated,
        eventType: EVENTS.meetingCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { meetingId, type: "committee", committeeId: series.committeeId, status: "draft", seriesId: series.id },
      });
    }

    // Advance the cursor to the day after the last generated instance (incremental re-runs).
    const lastIso = dates[dates.length - 1]!;
    const nextInstance = new Date(Date.parse(`${lastIso}T00:00:00Z`) + MS_PER_DAY).toISOString().slice(0, 10);
    await versionedUpdate(tx, meetingSeries, {
      id: series.id,
      tenantId: msg.tenantId,
      expectedVersion: series.version,
      set: { nextInstanceDate: nextInstance, updatedBy: msg.actorId, updatedAt: new Date() },
      entity: "meeting_series",
    });

    await enqueue(tx, {
      topic: EVENTS.meetingSeriesGenerated,
      eventType: EVENTS.meetingSeriesGenerated,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: { seriesId: series.id, committeeId: series.committeeId, generatedMeetingIds, upToDate: p.upToDate },
    });
    await audit(tx, msg, "generate", "meeting_series", series.id);
  });

  await invalidate(msg.tenantId, SERIES_RESOURCE, p.seriesId);
  for (const id of generatedMeetingIds) await invalidate(msg.tenantId, CACHE_RESOURCE, id);
}

/** meeting.meeting_type.create → INSERT template config + emit `meeting.meeting_type.created`. */
async function handleMeetingTypeCreate(msg: CommandEnvelope<MeetingTypeCreatePayload>): Promise<void> {
  const p = msg.payload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    await tx.insert(meetingTypes).values({
      id: p.id,
      tenantId: p.tenantId,
      code: p.code,
      name: p.name,
      description: p.description ?? null,
      templateConfig: p.templateConfig ?? null,
      isStatutory: p.isStatutory ?? false,
      frequency: p.frequency ?? null,
      createdBy: msg.actorId,
      updatedBy: msg.actorId,
    });
    await enqueue(tx, {
      topic: EVENTS.meetingTypeCreated,
      eventType: EVENTS.meetingTypeCreated,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: { meetingTypeId: p.id, code: p.code, name: p.name },
    });
    await audit(tx, msg, "create", "meeting_type", p.id);
  });
  await invalidate(msg.tenantId, MEETING_TYPE_RESOURCE, p.id);
}

/** meeting.meeting_type.update → optimistic-locked patch + emit `meeting.meeting_type.updated`. */
async function handleMeetingTypeUpdate(msg: CommandEnvelope<MeetingTypeUpdatePayload>): Promise<void> {
  const p = msg.payload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const set: Record<string, unknown> = { updatedBy: msg.actorId, updatedAt: new Date() };
    for (const [k, v] of Object.entries(p.patch)) {
      if (v !== undefined) set[k] = v;
    }
    await versionedUpdate(tx, meetingTypes, {
      id: p.meetingTypeId,
      tenantId: msg.tenantId,
      expectedVersion: p.version,
      set,
      entity: "meeting_type",
    });
    await enqueue(tx, {
      topic: EVENTS.meetingTypeUpdated,
      eventType: EVENTS.meetingTypeUpdated,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: { meetingTypeId: p.meetingTypeId },
    });
    await audit(tx, msg, "update", "meeting_type", p.meetingTypeId);
  });
  await invalidate(msg.tenantId, MEETING_TYPE_RESOURCE, p.meetingTypeId);
}

// ─── Registration ──────────────────────────────────────────────────────────────

/** A single-topic consumer handler (matches worker.ts `ConsumerHandler`). */
type ConsumerHandler<T = unknown> = (msg: CommandEnvelope<T>) => Promise<void>;
/** worker.ts `registerConsumer` shape — kept structural to avoid importing the worker. */
type RegisterConsumer = <T>(topic: string, handler: ConsumerHandler<T>) => void;

/**
 * Register every meeting-core command handler. worker.ts (task 19.1) calls this with its
 * `registerConsumer`, wiring the meeting-core COMMANDS topics to the handlers above.
 */
export function registerMeetingCoreConsumers(register: RegisterConsumer): void {
  register(COMMANDS.meetingCreate, handleMeetingCreate);
  register(COMMANDS.meetingUpdate, handleMeetingUpdate);
  register(COMMANDS.meetingTransition, handleMeetingTransition);
  register(COMMANDS.meetingCancel, handleMeetingCancel);
  register(COMMANDS.meetingSeriesCreate, handleSeriesCreate);
  register(COMMANDS.meetingSeriesUpdate, handleSeriesUpdate);
  register(COMMANDS.meetingSeriesGenerate, handleSeriesGenerate);
  register(COMMANDS.meetingTypeCreate, handleMeetingTypeCreate);
  register(COMMANDS.meetingTypeUpdate, handleMeetingTypeUpdate);
}
