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
import { and, eq, isNull, inArray, notInArray, count, sql } from "drizzle-orm";
import type { CommandEnvelope } from "@civitasone/queue";
import { NonRetryableError } from "@civitasone/queue";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed, versionedUpdate, type DrizzleTx } from "../../shared/outbox.js";
import { HttpError } from "../../shared/context.js";
import { COMMANDS, EVENTS, SERVICE } from "../../topics.js";
import { meetings, meetingSeries, meetingStateTransitions, meetingTypes } from "./schema.js";
import { agendaItems } from "../agenda/schema.js";
import { committees, committeeMembers } from "../committee/schema.js";
import { attendanceRecords } from "../attendance/schema.js";
import { participants } from "../participant/schema.js";
import { resolutions } from "../decision/schema.js";
import { roomBookings } from "../calendar/schema.js";
import { vcSessions } from "../vc-integration/schema.js";
import { evaluateQuorum, type QuorumRule } from "../committee/domain.js";
import {
  assertTransition,
  computeFinancialYear,
  computeNoticeDays,
  generateMeetingNumber,
  isDirectMeetingOwner,
  isMeetingState,
  nextMeetingSequence,
  CHAIR_STANDING_ROLES,
  SECRETARIAL_STANDING_ROLES,
  type MeetingState,
} from "./domain.js";
import { getPolicyNumber, getPolicyBool, getPolicyString } from "../config-registry/policy.js";

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
  shortNoticeWaiver?: boolean;
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

/**
 * Ownership/standing check (IDOR fix, Req 1.1, 1.3–1.6) — consumer-side defense-in-depth.
 * `meeting-core/routes.ts`'s `assertMeetingOwnership` guards the HTTP boundary (where JWT
 * roles are available, so admins get the documented bypass); THIS function guards the write
 * itself, reachable independently of the route (this fix's own regression test invokes the
 * handler directly to prove it). A `CommandEnvelope` carries only `actorId` — no role claim
 * (see services/queue-service/src/bus.ts's `CommandEnvelope` shape) — so there is nothing
 * here to safely trust for an admin bypass; this enforces the DB-verifiable ownership
 * invariant (chairperson/secretary of THIS meeting, or matching committee standing)
 * unconditionally for every caller. JUDGMENT CALL: this means a `meeting_admin`/
 * `tenant_admin`/`super_admin` acting on a meeting they have no chair/secretary/committee
 * relationship to is rejected here even though the route would have let them through — see
 * the PR description for the full writeup of this tradeoff.
 */
async function assertMeetingOwnership(
  tx: DrizzleTx,
  actorId: string,
  meeting: { id: string; tenantId: string; committeeId: string | null; chairpersonId: string | null; secretaryId: string | null },
  standingRoles: readonly string[],
): Promise<void> {
  if (isDirectMeetingOwner(actorId, meeting)) return;
  if (meeting.committeeId) {
    const rows = await tx
      .select({ id: committeeMembers.id })
      .from(committeeMembers)
      .where(
        and(
          eq(committeeMembers.tenantId, meeting.tenantId),
          eq(committeeMembers.committeeId, meeting.committeeId),
          eq(committeeMembers.memberId, actorId),
          eq(committeeMembers.status, "active"),
          inArray(committeeMembers.role, [...standingRoles]),
        ),
      )
      .limit(1);
    if (rows.length > 0) return;
  }
  throw new HttpError(
    403,
    "FORBIDDEN",
    `actor ${actorId} lacks ownership standing (chairperson/secretary or committee standing) over meeting ${meeting.id}`,
  );
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

/** Whole days in a given UTC year/zero-based-month (28–31). */
function daysInUtcMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/**
 * Move `d` FORWARD (never back) to the next date landing on UTC weekday `targetDow`
 * (0=Sunday … 6=Saturday, matching `Date#getUTCDay`). A no-op when `d` already matches.
 */
function alignToDayOfWeek(d: Date, targetDow: number): Date {
  const delta = (((targetDow - d.getUTCDay()) % 7) + 7) % 7;
  if (delta === 0) return d;
  const next = new Date(d.getTime());
  next.setUTCDate(next.getUTCDate() + delta);
  return next;
}

/**
 * Move `d` to `targetDom` (1-based) within its own UTC month, clamped to that month's actual
 * length (e.g. 31 in a 30-day month → the 30th, not an overflow into next month). If that
 * clamped date falls BEFORE `d`, roll forward to `targetDom` in the FOLLOWING month instead
 * (never moves backward relative to `d`).
 */
function alignToDayOfMonth(d: Date, targetDom: number): Date {
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const wanted = Math.min(Math.max(1, Math.trunc(targetDom)), daysInUtcMonth(year, month));
  const candidate = new Date(Date.UTC(year, month, wanted));
  if (candidate.getTime() >= d.getTime()) return candidate;

  const nextMonthIndex = month + 1;
  const ny = year + Math.floor(nextMonthIndex / 12);
  const nm = ((nextMonthIndex % 12) + 12) % 12;
  const nextWanted = Math.min(Math.max(1, Math.trunc(targetDom)), daysInUtcMonth(ny, nm));
  return new Date(Date.UTC(ny, nm, nextWanted));
}

/**
 * Materialise the recurrence dates (ISO `YYYY-MM-DD`) for a series: starting at `fromIso`,
 * stepping by `pattern`, up to and including `upToIso`, bounded by an optional `endIso` and a
 * hard `MAX_SERIES_INSTANCES` cap. Returns `[]` when the window is empty.
 *
 * Req 14.5 dead-config fix: `dayOfWeek` (weekly/fortnightly) / `dayOfMonth` (monthly/quarterly/
 * half_yearly/annual) were persisted on the series but never consulted here — every instance
 * silently landed on `fromIso`'s own weekday/day-of-month regardless of what was configured.
 * When the relevant field is set, EVERY generated date (including the first) is re-aligned to
 * it via `alignToDayOfWeek`/`alignToDayOfMonth`; re-aligning an already-aligned date is a no-op,
 * so this is safe to apply unconditionally after each `advance()` step too (guards month-length
 * edge cases, e.g. `dayOfMonth: 31` rolling through February).
 */
function generateInstanceDates(args: {
  pattern: string;
  fromIso: string;
  upToIso: string;
  endIso: string | null;
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
}): string[] {
  const { pattern, fromIso, upToIso, endIso, dayOfWeek, dayOfMonth } = args;
  const upTo = Date.parse(`${upToIso}T00:00:00Z`);
  const end = endIso ? Date.parse(`${endIso}T00:00:00Z`) : Number.POSITIVE_INFINITY;
  const ceiling = Math.min(upTo, end);

  const isWeeklyFamily = pattern === "weekly" || pattern === "fortnightly";
  const isMonthlyFamily = pattern === "monthly" || pattern === "quarterly" || pattern === "half_yearly" || pattern === "annual";
  const align = (d: Date): Date => {
    if (isWeeklyFamily && dayOfWeek !== undefined && dayOfWeek !== null) return alignToDayOfWeek(d, dayOfWeek);
    if (isMonthlyFamily && dayOfMonth !== undefined && dayOfMonth !== null) return alignToDayOfMonth(d, dayOfMonth);
    return d;
  };

  const out: string[] = [];
  let cursor = align(new Date(Date.parse(`${fromIso}T00:00:00Z`)));
  while (cursor.getTime() <= ceiling && out.length < MAX_SERIES_INSTANCES) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor = align(advance(cursor, pattern));
  }
  return out;
}

/**
 * Combine an ISO date + optional `HH:MM` time-of-day + the tenant's configured UTC offset into
 * a timestamptz (Req 14.5 timezone fix). Previously hardcoded a literal `Z` (UTC) with no
 * tenant-timezone concept anywhere in the service — a secretary configuring "10:00" got every
 * instance scheduled at 10:00 UTC regardless of their actual local time. `utcOffset` is a
 * `±HH:MM` numeric offset (same representation `validators.ts`'s plain-meeting `scheduledAt`
 * already requires via `z.string().datetime({ offset: true })` — this mirrors that existing
 * convention rather than introducing an IANA-zone dependency) resolved by the caller from
 * `config-registry` (`meeting.tenant_timezone`, default `"+00:00"` — see `handleSeriesGenerate`).
 * An invalid offset falls back to `+00:00`, matching `timeOfDay`'s existing fallback-on-garbage
 * behavior below.
 */
function toScheduledAt(dateIso: string, timeOfDay: string | null, utcOffset: string): Date {
  const time = timeOfDay && /^([01]\d|2[0-3]):[0-5]\d$/.test(timeOfDay) ? timeOfDay : "00:00";
  const offset = /^[+-]([01]\d|2[0-3]):[0-5]\d$/.test(utcOffset) ? utcOffset : "+00:00";
  return new Date(`${dateIso}T${time}:00${offset}`);
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
    try {
      await assertMeetingOwnership(tx, msg.actorId, meeting, SECRETARIAL_STANDING_ROLES);
    } catch (err) {
      asPermanent(err);
    }

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

/**
 * Recompute quorum LIVE from the current attendance set (Gap 5: quorum re-check on resumption).
 * Used when a meeting resumes after an adjournment so the resumed sitting is validated against who
 * is ACTUALLY present now — not the stale flag captured when the meeting first started. Reuses the
 * committee quorum evaluator so "what counts" (VC inclusion, role composition) matches establishment
 * exactly. Returns the meeting's stored flag as a safe fallback when it has no committee.
 */
async function computeLiveQuorum(
  tx: DrizzleTx,
  meeting: typeof meetings.$inferSelect,
): Promise<boolean> {
  if (!meeting.committeeId) return meeting.quorumEstablished;
  const committeeRows = await tx
    .select({ quorumRule: committees.quorumRule })
    .from(committees)
    .where(and(eq(committees.id, meeting.committeeId), eq(committees.tenantId, meeting.tenantId)))
    .limit(1);
  if (!committeeRows[0]) return meeting.quorumEstablished;
  const rule = committeeRows[0].quorumRule as QuorumRule;

  const roster = await tx
    .select({ memberId: committeeMembers.memberId })
    .from(committeeMembers)
    .where(and(
      eq(committeeMembers.tenantId, meeting.tenantId),
      eq(committeeMembers.committeeId, meeting.committeeId),
      eq(committeeMembers.status, "active"),
    ));
  const attendance = await tx
    .select({ status: attendanceRecords.status, mode: attendanceRecords.mode })
    .from(attendanceRecords)
    .where(and(eq(attendanceRecords.meetingId, meeting.id), eq(attendanceRecords.tenantId, meeting.tenantId)));

  return evaluateQuorum(attendance, rule, roster.length).established;
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
    shortNoticeWaiver?: boolean;
  },
): Promise<void> {
  const { meeting, to, expectedVersion, reason, nextMeetingDate, shortNoticeWaiver } = args;
  const from = requireMeetingState(meeting.status);
  const now = new Date();

  // Gather agenda count only when it matters (draft→scheduled prerequisite, Req 1.3).
  const scheduling = from === "draft" && to === "scheduled";
  const agendaItemCount = scheduling
    ? await countAgendaItems(tx, meeting.id, meeting.tenantId)
    : undefined;

  // Notice period (Gap 3): resolve the tenant's configured minimum only when scheduling.
  const noticePeriodDays = scheduling
    ? await getPolicyNumber(tx, meeting.tenantId, "meeting.notice_period_days")
    : undefined;

  // Quorum re-check on resumption (Gap 5): when resuming from adjournment, re-evaluate quorum
  // LIVE (config-gated by `quorum.recheck_on_resume`, default ON) rather than trusting the flag.
  const resuming = from === "adjourned" && to === "in_progress";
  let quorumEstablished = meeting.quorumEstablished;
  if (resuming && (await getPolicyBool(tx, meeting.tenantId, "quorum.recheck_on_resume"))) {
    quorumEstablished = await computeLiveQuorum(tx, meeting);
  }

  try {
    // Conditional spread keeps this compatible with exactOptionalPropertyTypes
    // (never assign an explicit `undefined` to an optional field).
    assertTransition(from, to, {
      now,
      chairpersonId: meeting.chairpersonId,
      scheduledAt: meeting.scheduledAt,
      quorumEstablished,
      adjournmentReason: to === "adjourned" ? reason : meeting.adjournmentReason,
      ...(agendaItemCount !== undefined ? { agendaItemCount } : {}),
      ...(noticePeriodDays !== undefined ? { noticePeriodDays } : {}),
      ...(shortNoticeWaiver !== undefined ? { shortNoticeWaiver } : {}),
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
  // Notice-period audit trail (Gap 3): record actual notice days and whether a short-notice
  // scheduling was waived. Reaching here means the transition passed validateNoticePeriod.
  if (scheduling && meeting.scheduledAt) {
    const actualNotice = computeNoticeDays(now, meeting.scheduledAt);
    set.noticeDays = actualNotice;
    set.shortNoticeWaived =
      noticePeriodDays !== undefined && actualNotice < noticePeriodDays && shortNoticeWaiver === true;
  }
  // On a re-established resume, refresh the stored quorum flag to the live re-check result.
  if (resuming) set.quorumEstablished = quorumEstablished;
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
    try {
      await assertMeetingOwnership(tx, msg.actorId, meeting, CHAIR_STANDING_ROLES);
    } catch (err) {
      asPermanent(err);
    }

    await applyTransition(tx, { ...msg }, {
      meeting,
      to,
      expectedVersion: p.version,
      reason: p.reason ?? null,
      nextMeetingDate: p.nextMeetingDate ?? null,
      ...(p.shortNoticeWaiver !== undefined ? { shortNoticeWaiver: p.shortNoticeWaiver } : {}),
    });
    await audit(tx, msg, `transition:${to}`, "meeting", p.meetingId);
  });
  await invalidate(msg.tenantId, CACHE_RESOURCE, p.meetingId);
}

// ─── Cancel cascade (Req 1.6 completeness fix) ────────────────────────────────
//
// Cross-referenced literals mirrored from sibling modules that own them (this module does
// not import their consumer/domain files — see the module-scope rule at the top of this
// file). Each is the exact value that module's OWN gate already checks against:
//   - RESOLUTION_STATUS_VOID / RESOLUTION_OPEN_STATUSES: voting/consumer.ts's local
//     `STATUS_VOTING_OPEN`/`STATUS_CIRCULATING`/`TERMINAL_STATUSES` (= {effective, rejected,
//     invalid}) are not exported; "invalid" is the correct terminal member for a resolution
//     that never reached a real conclusion because its meeting was cancelled — NOT
//     decision/domain.ts's separate (also unexported-for-this-purpose) RESOLUTION_STATUSES
//     lifecycle-record vocabulary, which has no "cancelled" analogue.
//   - ROOM_BOOKING_CONFIRMED / ROOM_BOOKING_CANCELLED: calendar/domain.ts's exported
//     `ROOM_BOOKING_STATUSES = ["confirmed", "cancelled"]`, mirrored as literals (matches
//     calendar/consumer.ts's own local `BOOKING_CONFIRMED`/`BOOKING_CANCELLED` treatment).
//   - VC_SESSION_STATUS_ENDED: vc-integration/consumer.ts's local `STATUS_ENDED`, unexported.
//   - AGENDA_ITEM_STATUS_MOOT: this module's OWN sibling, agenda/domain.ts `AGENDA_STATUSES`
//     (exported; "withdrawn" already means "no longer active").

/** voting/consumer.ts TERMINAL_STATUSES' "never concluded" member (see comment above). */
const RESOLUTION_STATUS_VOID = "invalid";
/** voting/repo.ts ACTIVE_STATUSES (resolutions still open to a vote). */
const RESOLUTION_OPEN_STATUSES = ["voting_open", "circulating"];
/** calendar/domain.ts ROOM_BOOKING_STATUSES members (see comment above). */
const ROOM_BOOKING_CONFIRMED = "confirmed";
const ROOM_BOOKING_CANCELLED = "cancelled";
/** vc-integration/consumer.ts STATUS_ENDED. */
const VC_SESSION_STATUS_ENDED = "ended";
/** agenda/domain.ts AGENDA_STATUSES member meaning "no longer active" — reused for "moot". */
const AGENDA_ITEM_STATUS_MOOT = "withdrawn";
/** Agenda statuses that already have their own disposition; left untouched by the cascade. */
const AGENDA_ITEM_CASCADE_EXEMPT_STATUSES = [AGENDA_ITEM_STATUS_MOOT, "carried_forward"];

/**
 * Cascade a meeting's cancellation to everything that was depending on it happening (Req 1.6
 * completeness fix — previously `handleMeetingCancel` flipped only `meetings.status`, leaving
 * an open resolution still votable, a confirmed room booking, a live VC session, moot-but-
 * "accepted" agenda items, and zero notifications). Runs in the SAME tx as the cancel itself
 * so the whole cascade is atomic with the state transition. Writes other modules' tables
 * directly (this codebase's established cross-module-write convention — see e.g.
 * `computeLiveQuorum` above reading `committee_members`); does not touch voting/decision/
 * calendar/vc-integration/agenda's own route/consumer/domain files.
 */
async function cascadeMeetingCancel(
  tx: DrizzleTx,
  msg: MsgMeta,
  meetingId: string,
  committeeId: string | null,
): Promise<void> {
  const now = new Date();

  // Void any still-open resolution — blocks voting/consumer.ts's `status !== "voting_open"`
  // cast gate and its `TERMINAL_STATUSES.has(status)` idempotent-no-op conclude guard from
  // ever treating this resolution as live again. Existing cast votes remain as historical
  // record (a ledger, not a mutable tally); nothing further can be cast or concluded on it.
  await tx
    .update(resolutions)
    .set({
      status: RESOLUTION_STATUS_VOID,
      updatedBy: msg.actorId,
      updatedAt: now,
      version: sql`${resolutions.version} + 1`,
    })
    .where(
      and(
        eq(resolutions.tenantId, msg.tenantId),
        eq(resolutions.meetingId, meetingId),
        inArray(resolutions.status, RESOLUTION_OPEN_STATUSES),
      ),
    );

  // Release the confirmed room booking.
  await tx
    .update(roomBookings)
    .set({
      status: ROOM_BOOKING_CANCELLED,
      updatedBy: msg.actorId,
      updatedAt: now,
      version: sql`${roomBookings.version} + 1`,
    })
    .where(
      and(
        eq(roomBookings.tenantId, msg.tenantId),
        eq(roomBookings.meetingId, meetingId),
        eq(roomBookings.status, ROOM_BOOKING_CONFIRMED),
      ),
    );

  // End the live VC session.
  await tx
    .update(vcSessions)
    .set({
      status: VC_SESSION_STATUS_ENDED,
      endedAt: now,
      updatedBy: msg.actorId,
      updatedAt: now,
      version: sql`${vcSessions.version} + 1`,
    })
    .where(
      and(
        eq(vcSessions.tenantId, msg.tenantId),
        eq(vcSessions.meetingId, meetingId),
        eq(vcSessions.status, "active"),
      ),
    );

  // Mark surviving agenda items moot — the agenda is now frozen (fix for `assertAgendaNotLocked`
  // separately blocks further edits); items that already carry their own disposition
  // (withdrawn / carried_forward) are left untouched.
  await tx
    .update(agendaItems)
    .set({
      status: AGENDA_ITEM_STATUS_MOOT,
      updatedBy: msg.actorId,
      updatedAt: now,
      version: sql`${agendaItems.version} + 1`,
    })
    .where(
      and(
        eq(agendaItems.tenantId, msg.tenantId),
        eq(agendaItems.meetingId, meetingId),
        notInArray(agendaItems.status, AGENDA_ITEM_CASCADE_EXEMPT_STATUSES),
      ),
    );

  // Notify everyone with a stake in this meeting (mirrors participant/consumer.ts's `notify()`
  // convention — `NOTIFICATION_SEND` / `buildNotificationPayload` — which this module never
  // previously used). Unions the meeting's own invited roster (`meeting.participants`, the
  // normal case) with its committee's active membership (`committee_members`) — a meeting can
  // legitimately reach `adjourned`/cancellable with committee members who were never
  // individually added as `participants` rows, and they still have a stake in knowing their
  // committee's meeting was cancelled.
  const rosterRows = await tx
    .select({ employeeId: participants.employeeId })
    .from(participants)
    .where(and(eq(participants.tenantId, msg.tenantId), eq(participants.meetingId, meetingId)));
  const recipientIds = new Set(rosterRows.map((r) => r.employeeId));
  if (committeeId) {
    const memberRows = await tx
      .select({ memberId: committeeMembers.memberId })
      .from(committeeMembers)
      .where(
        and(
          eq(committeeMembers.tenantId, msg.tenantId),
          eq(committeeMembers.committeeId, committeeId),
          eq(committeeMembers.status, "active"),
        ),
      );
    for (const { memberId } of memberRows) recipientIds.add(memberId);
  }
  for (const employeeId of recipientIds) {
    await enqueue(tx, {
      topic: NOTIFICATION_SEND,
      eventType: NOTIFICATION_SEND,
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      payload: buildNotificationPayload({
        eventType: EVENTS.meetingCancelled,
        recipient: employeeId,
        recipientId: employeeId,
        channel: "email",
        variables: { meetingId },
      }),
    });
  }
}

/** meeting.cancel → soft-cancel to the terminal `cancelled` state (Req 1.6, 1.7) + full cascade. */
async function handleMeetingCancel(msg: CommandEnvelope<MeetingCancelPayload>): Promise<void> {
  const p = msg.payload;
  await db.transaction(async (tx) => {
    if (!(await markProcessed(tx, msg.messageId))) return;
    const meeting = await loadMeeting(tx, p.meetingId, msg.tenantId);
    if (!meeting) return;
    try {
      await assertMeetingOwnership(tx, msg.actorId, meeting, CHAIR_STANDING_ROLES);
    } catch (err) {
      asPermanent(err);
    }

    await applyTransition(tx, { ...msg }, {
      meeting,
      to: "cancelled",
      expectedVersion: p.version,
      reason: p.reason,
      nextMeetingDate: null,
    });
    await audit(tx, msg, "cancel", "meeting", p.meetingId);
    await cascadeMeetingCancel(tx, msg, p.meetingId, meeting.committeeId);
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
      dayOfWeek: series.dayOfWeek,
      dayOfMonth: series.dayOfMonth,
    });
    if (dates.length === 0) return;

    // Req 14.5 timezone fix: resolve the tenant's configured UTC offset (default "+00:00" —
    // behavior-preserving for a tenant that has configured nothing, matching every other
    // config-registry policy's stated migration contract).
    const utcOffset = await getPolicyString(tx, msg.tenantId, "meeting.tenant_timezone");

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
      const scheduledAt = toScheduledAt(dateIso, series.timeOfDay, utcOffset);
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
