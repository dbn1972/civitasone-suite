/**
 * Scheduled worker — statutory meeting-frequency compliance check (Req 2.5, 16.2).
 *
 * A committee that carries a statutory meeting obligation (e.g. the Finance Committee
 * must meet quarterly per GFR Rule 89) is expected to hold a meeting at least once per
 * its configured `meeting_frequency`. This worker runs DAILY, scans every active
 * committee whose `meeting_frequency` is set, and — for each committee that is overdue
 * (the next meeting was due before today, anchored to its last held meeting, or its
 * constitution date if it has never met) — emits a `meeting.compliance.statutory_overdue`
 * event via the transactional outbox and notifies the committee's secretary.
 *
 * Design notes
 * ────────────
 * • Pure detection: the overdue determination is a set of pure, deterministic functions
 *   (`nextStatutoryDueDate`, `evaluateStatutoryDue`, `detectOverdueCommittees`,
 *   `buildStatutoryOverdueMessages`) that take an injected `today`/`now`. They own the
 *   correctness of the check and are exhaustively unit-tested (no clock/I/O coupling).
 *   The frequency-period semantics mirror committee/repo.ts `getComplianceReport`
 *   (UTC calendar arithmetic — no DST skew) so the ad-hoc endpoint (Req 2.5) and this
 *   scheduled sweep agree.
 *
 * • Cross-tenant scan, per-tenant write: the candidate scan reads committees across all
 *   tenants (mirroring the outbox relay's cross-tenant sweep in worker.ts). Every WRITE
 *   (outbox enqueue + notification) is performed inside `runWithTenant(tenantId, …)` so
 *   the per-transaction `app.tenant_id` GUC is set and RLS/tenant isolation holds
 *   (steering: multi-tenant isolation; SAST-003 tenant GUC).
 *
 * • Dependency seams: `runStatutoryFrequencyCheck` accepts injectable `loadCandidates`,
 *   `loadSecretaryRecipients`, and `emit` so the orchestration is testable without a live
 *   database. Production defaults bind to the real Drizzle client + transactional outbox.
 *
 * • Runnable entrypoint: `runStatutoryFrequencyCheck` is exported for worker.ts
 *   (task 19.1 / 24.3) to schedule on a daily cadence. This module intentionally does NOT
 *   register a timer itself — scheduling/lifecycle is the worker entrypoint's concern.
 *
 * _Requirements: 2.5, 16.2_
 */
import { randomUUID } from "node:crypto";
import { pino, type Logger } from "pino";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db as defaultDb } from "../shared/db.js";
import { scannerDb } from "../shared/scanner-db.js";
import { enqueue, type DrizzleTx } from "../shared/outbox.js";
import { EVENTS, SERVICE } from "../topics.js";
import { committees, committeeMembers } from "../modules/committee/schema.js";
import { meetings } from "../modules/meeting-core/schema.js";

const AUDIT_TOPIC = "audit.event.record";

/** Nil-UUID actor for system-initiated (cron) writes — carries no human actor. */
export const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

/** Default cadence for the scheduler: once per day (Req 2.5 — daily statutory sweep). */
export const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Meeting statuses that count as an actually-held meeting for frequency compliance.
 * Mirrors committee/repo.ts `HELD_STATUSES` so the scheduled sweep and the on-demand
 * compliance report agree on what "the committee met" means.
 */
export const HELD_STATUSES = [
  "in_progress",
  "adjourned",
  "minutes_pending",
  "minutes_approved",
  "closed",
  "archived",
] as const;

// ─── Pure frequency arithmetic ─────────────────────────────────────────────────

/** ISO `YYYY-MM-DD` for a Date | ISO-string value (or null passthrough). */
export function toIsoDate(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Advance an ISO `YYYY-MM-DD` date by one statutory frequency period. Returns null for
 * `ad_hoc` / unknown frequencies (no fixed obligation). Uses UTC calendar arithmetic so
 * month/quarter/year steps land on the correct calendar date without DST skew.
 */
export function nextStatutoryDueDate(anchorIso: string, frequency: string): string | null {
  const d = new Date(`${anchorIso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  switch (frequency) {
    case "weekly":      d.setUTCDate(d.getUTCDate() + 7); break;
    case "fortnightly": d.setUTCDate(d.getUTCDate() + 14); break;
    case "monthly":     d.setUTCMonth(d.getUTCMonth() + 1); break;
    case "quarterly":   d.setUTCMonth(d.getUTCMonth() + 3); break;
    case "half_yearly": d.setUTCMonth(d.getUTCMonth() + 6); break;
    case "annual":      d.setUTCFullYear(d.getUTCFullYear() + 1); break;
    default:            return null; // ad_hoc / unrecognised → no obligation
  }
  return d.toISOString().slice(0, 10);
}

/** Whole days between two ISO dates (`later - earlier`), using UTC midnight. */
export function daysBetween(earlierIso: string, laterIso: string): number {
  const MS_PER_DAY = 86_400_000;
  const a = Date.parse(`${earlierIso}T00:00:00Z`);
  const b = Date.parse(`${laterIso}T00:00:00Z`);
  return Math.round((b - a) / MS_PER_DAY);
}

/** Result of evaluating one committee's statutory obligation against `today`. */
export interface StatutoryDueEvaluation {
  /** ISO date the next meeting is due by, or null when no frequency obligation applies. */
  nextDueDate: string | null;
  /** True when a frequency obligation exists and the next-due date is strictly before today. */
  overdue: boolean;
  /** Whole days past the due date (0 when not overdue). */
  daysOverdue: number;
}

/**
 * Evaluate whether a committee is overdue for its statutory meeting (pure, Req 2.5).
 *
 * The obligation is anchored to `anchorDate` (the last held meeting, else the committee's
 * constitution date). A committee is overdue IFF a due date can be derived from its
 * frequency AND that due date is strictly before `today`.
 */
export function evaluateStatutoryDue(args: {
  frequency: string;
  anchorDate: string;
  today: string;
}): StatutoryDueEvaluation {
  const nextDueDate = nextStatutoryDueDate(args.anchorDate, args.frequency);
  if (nextDueDate === null || nextDueDate >= args.today) {
    return { nextDueDate, overdue: false, daysOverdue: 0 };
  }
  return { nextDueDate, overdue: true, daysOverdue: daysBetween(nextDueDate, args.today) };
}

// ─── Candidate + overdue models ──────────────────────────────────────────────────

/** A committee carrying a statutory frequency obligation, as read from the DB. */
export interface StatutoryCommitteeCandidate {
  committeeId: string;
  tenantId: string;
  /** Committee frequency obligation (`weekly`…`annual`); `ad_hoc`/unknown ⇒ no obligation. */
  meetingFrequency: string;
  statutoryBasis: string | null;
  /** ISO date of the most recent held meeting, or null if the committee has never met. */
  lastMeetingDate: string | null;
  /** ISO constitution date — the obligation anchor when the committee has never met. */
  constitutionDate: string;
}

/** A committee determined to be overdue for its statutory meeting. */
export interface OverdueCommittee {
  committeeId: string;
  tenantId: string;
  statutoryBasis: string | null;
  /** ISO date the meeting was due by (the missed obligation date). */
  expectedBy: string;
  /** ISO anchor used to compute the obligation (last meeting, else constitution date). */
  anchorDate: string;
  /** ISO date of the last held meeting, or null if the committee has never met. */
  lastMeetingDate: string | null;
  /** Whole days past the due date. */
  daysOverdue: number;
}

/**
 * Detect the overdue committees among a set of candidates as of `todayIso` (pure, Req 2.5).
 * The anchor is the last held meeting date, falling back to the constitution date when the
 * committee has never met. Candidates whose frequency yields no obligation (`ad_hoc`/unknown)
 * or whose next-due date has not yet passed are excluded.
 */
export function detectOverdueCommittees(
  candidates: readonly StatutoryCommitteeCandidate[],
  todayIso: string,
): OverdueCommittee[] {
  const overdue: OverdueCommittee[] = [];
  for (const c of candidates) {
    const anchorDate = c.lastMeetingDate ?? c.constitutionDate;
    const evaluation = evaluateStatutoryDue({
      frequency: c.meetingFrequency,
      anchorDate,
      today: todayIso,
    });
    if (!evaluation.overdue || evaluation.nextDueDate === null) continue;
    overdue.push({
      committeeId: c.committeeId,
      tenantId: c.tenantId,
      statutoryBasis: c.statutoryBasis,
      expectedBy: evaluation.nextDueDate,
      anchorDate,
      lastMeetingDate: c.lastMeetingDate,
      daysOverdue: evaluation.daysOverdue,
    });
  }
  return overdue;
}

// ─── Outbox message construction (pure) ──────────────────────────────────────────

/** An outbox message input (matches @civitasone/outbox `enqueue`). */
export interface OutboxMessageInput {
  topic: string;
  eventType: string;
  tenantId: string;
  actorId: string;
  correlationId: string;
  payload: Record<string, unknown>;
}

/**
 * Build the outbox messages for one overdue committee (pure, Req 2.5, 16.2):
 *   1. `meeting.compliance.statutory_overdue` — the canonical compliance fact
 *      (payload per topics.ts: `{ committeeId, expectedBy, statutoryBasis }`, plus the
 *      anchor/last-meeting context). Consumed by notification-service and admin/compliance
 *      dashboards to alert the tenant administrator.
 *   2. one `notification.send` per secretary recipient — the direct secretary alert
 *      (Req 2.5), addressed by member id (never PII; steering: NEVER log/emit PII).
 *   3. an `audit.event.record` fact — CERT-In structured audit on every emission (Req 16.2).
 *
 * Notification `variables` carry only non-PII committee/obligation metadata.
 */
export function buildStatutoryOverdueMessages(
  overdue: OverdueCommittee,
  secretaryRecipientIds: readonly string[],
  meta: { actorId: string; correlationId: string },
): OutboxMessageInput[] {
  const base = {
    tenantId: overdue.tenantId,
    actorId: meta.actorId,
    correlationId: meta.correlationId,
  };

  const messages: OutboxMessageInput[] = [];

  // (1) Canonical compliance fact.
  messages.push({
    ...base,
    topic: EVENTS.statutoryMeetingOverdue,
    eventType: EVENTS.statutoryMeetingOverdue,
    payload: {
      committeeId: overdue.committeeId,
      expectedBy: overdue.expectedBy,
      statutoryBasis: overdue.statutoryBasis,
      lastMeetingDate: overdue.lastMeetingDate,
      daysOverdue: overdue.daysOverdue,
    },
  });

  // (2) Direct secretary notification(s).
  const variables: Record<string, string> = {
    committeeId: overdue.committeeId,
    expectedBy: overdue.expectedBy,
    daysOverdue: String(overdue.daysOverdue),
    ...(overdue.statutoryBasis ? { statutoryBasis: overdue.statutoryBasis } : {}),
  };
  for (const recipientId of secretaryRecipientIds) {
    messages.push({
      ...base,
      topic: NOTIFICATION_SEND,
      eventType: NOTIFICATION_SEND,
      payload: buildNotificationPayload({
        eventType: EVENTS.statutoryMeetingOverdue,
        recipient: recipientId,
        recipientId,
        channel: "email",
        variables,
      }) as unknown as Record<string, unknown>,
    });
  }

  // (3) Audit fact (CERT-In, Req 16.2).
  messages.push({
    ...base,
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    payload: {
      service: SERVICE,
      action: "statutory_meeting_overdue",
      resourceType: "committee",
      resourceId: overdue.committeeId,
      outcome: "success",
      metadata: { expectedBy: overdue.expectedBy, daysOverdue: overdue.daysOverdue },
    },
  });

  return messages;
}

// ─── Orchestration ───────────────────────────────────────────────────────────────

/** Injectable dependencies for the worker (production defaults bind to the real db/outbox). */
export interface StatutoryFrequencyCheckDeps {
  /** Reference instant; defaults to `new Date()`. Used to derive `today` (UTC date). */
  now?: Date;
  /** Pino logger (defaults to a module logger). */
  logger?: Logger;
  /** Cross-tenant scan of committees with a statutory frequency obligation. */
  loadCandidates?: () => Promise<StatutoryCommitteeCandidate[]>;
  /** Resolve the active secretary member ids of a committee (tenant-scoped). */
  loadSecretaryRecipients?: (committee: OverdueCommittee) => Promise<string[]>;
  /** Emit the outbox messages for one overdue committee (tenant-scoped write). */
  emit?: (overdue: OverdueCommittee, messages: OutboxMessageInput[]) => Promise<void>;
}

/** Summary of a single worker run. */
export interface StatutoryFrequencyCheckResult {
  /** Committees scanned (with a frequency obligation). */
  scanned: number;
  /** Committees found overdue. */
  overdue: number;
  /** Committees for which compliance events were successfully emitted. */
  emitted: number;
  /** Overdue committees whose emission failed (isolated + counted; retried next run). */
  failed: number;
}

/**
 * Run one statutory meeting-frequency compliance sweep (Req 2.5, 16.2).
 *
 * Runnable entrypoint for worker.ts (task 19.1 / 24.3) to schedule daily. Scans all active
 * committees with a frequency obligation, detects the overdue ones, and — per overdue
 * committee, inside its tenant context — emits the compliance event + secretary
 * notification(s) + audit fact via the transactional outbox. A per-committee emission
 * failure is logged and counted but never aborts the whole sweep.
 */
export async function runStatutoryFrequencyCheck(
  deps: StatutoryFrequencyCheckDeps = {},
): Promise<StatutoryFrequencyCheckResult> {
  const now = deps.now ?? new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const log = deps.logger ?? pino({ name: "meeting-statutory-frequency-check" });
  const loadCandidates = deps.loadCandidates ?? defaultLoadCandidates;
  const loadSecretaryRecipients = deps.loadSecretaryRecipients ?? defaultLoadSecretaryRecipients;
  const emit = deps.emit ?? defaultEmit;

  const candidates = await loadCandidates();
  const overdueCommittees = detectOverdueCommittees(candidates, todayIso);

  let emitted = 0;
  let failed = 0;
  for (const overdue of overdueCommittees) {
    const correlationId = `statutory-check-${randomUUID()}`;
    try {
      const recipients = await loadSecretaryRecipients(overdue);
      const messages = buildStatutoryOverdueMessages(overdue, recipients, {
        actorId: SYSTEM_ACTOR_ID,
        correlationId,
      });
      await emit(overdue, messages);
      emitted += 1;
      log.info(
        {
          committeeId: overdue.committeeId,
          tenantId: overdue.tenantId,
          expectedBy: overdue.expectedBy,
          daysOverdue: overdue.daysOverdue,
          recipients: recipients.length,
        },
        "statutory meeting overdue — compliance event emitted",
      );
    } catch (err) {
      // Isolate per-committee failures so one bad row never stalls the sweep.
      failed += 1;
      log.error(
        {
          committeeId: overdue.committeeId,
          tenantId: overdue.tenantId,
          err: err instanceof Error ? err.stack : String(err),
        },
        "failed to emit statutory-overdue compliance event",
      );
    }
  }

  const result: StatutoryFrequencyCheckResult = {
    scanned: candidates.length,
    overdue: overdueCommittees.length,
    emitted,
    failed,
  };
  log.info({ ...result, today: todayIso }, "statutory meeting-frequency check complete");
  return result;
}

// ─── Production data-access defaults ─────────────────────────────────────────────

/**
 * Cross-tenant scan of active committees carrying a statutory frequency obligation, with
 * each committee's most-recent held-meeting date. Reads across tenants (like the outbox
 * relay); the tenant GUC is applied on the per-tenant WRITE path, not this maintenance scan.
 */
async function defaultLoadCandidates(): Promise<StatutoryCommitteeCandidate[]> {
  // Cross-tenant scan via BYPASSRLS scanner pool (migration 0007) — see scanner-db.ts.
  const committeeRows = await scannerDb
    .select({
      committeeId: committees.id,
      tenantId: committees.tenantId,
      meetingFrequency: committees.meetingFrequency,
      statutoryBasis: committees.statutoryBasis,
      constitutionDate: committees.constitutionDate,
    })
    .from(committees)
    .where(and(eq(committees.status, "active"), isNotNull(committees.meetingFrequency)));

  if (committeeRows.length === 0) return [];

  const committeeIds = committeeRows.map((r) => r.committeeId);
  const lastMeetingRows = await scannerDb
    .select({
      committeeId: meetings.committeeId,
      lastAt: sql<Date | null>`max(coalesce(${meetings.actualStartAt}, ${meetings.scheduledAt}))`,
    })
    .from(meetings)
    .where(and(inArray(meetings.committeeId, committeeIds), inArray(meetings.status, [...HELD_STATUSES])))
    .groupBy(meetings.committeeId);

  const lastByCommittee = new Map<string, string | null>();
  for (const row of lastMeetingRows) {
    if (row.committeeId) lastByCommittee.set(row.committeeId, toIsoDate(row.lastAt));
  }

  const candidates: StatutoryCommitteeCandidate[] = [];
  for (const r of committeeRows) {
    const constitutionDate = toIsoDate(r.constitutionDate);
    // A committee with no valid constitution date and no meetings has no anchor — skip.
    if (constitutionDate === null) continue;
    candidates.push({
      committeeId: r.committeeId,
      tenantId: r.tenantId,
      meetingFrequency: r.meetingFrequency as string,
      statutoryBasis: r.statutoryBasis ?? null,
      lastMeetingDate: lastByCommittee.get(r.committeeId) ?? null,
      constitutionDate,
    });
  }
  return candidates;
}

/** Resolve the active secretary member ids of a committee (tenant-scoped read). */
async function defaultLoadSecretaryRecipients(overdue: OverdueCommittee): Promise<string[]> {
  return runWithTenant(overdue.tenantId, async () => {
    const rows = await defaultDb
      .select({ memberId: committeeMembers.memberId })
      .from(committeeMembers)
      .where(
        and(
          eq(committeeMembers.tenantId, overdue.tenantId),
          eq(committeeMembers.committeeId, overdue.committeeId),
          eq(committeeMembers.role, "secretary"),
          eq(committeeMembers.status, "active"),
        ),
      );
    return rows.map((r) => r.memberId);
  });
}

/** Emit the outbox messages for one overdue committee inside its tenant transaction. */
async function defaultEmit(overdue: OverdueCommittee, messages: OutboxMessageInput[]): Promise<void> {
  await runWithTenant(overdue.tenantId, async () => {
    await defaultDb.transaction(async (tx: DrizzleTx) => {
      for (const message of messages) {
        await enqueue(tx, message);
      }
    });
  });
}

// ─── Scheduler ─────────────────────────────────────────────────────────────────

/**
 * Start the daily statutory meeting-frequency scheduler. Runs
 * `runStatutoryFrequencyCheck` every `intervalMs` (default 24h) and never rethrows — a
 * failing cycle is logged and the loop continues (mirrors `startOutboxPurge`/`startRelay`
 * and the sibling `startTenureExpiryScheduler`). Returns the interval handle so worker.ts
 * (task 19.1 / 24.3) can `clearInterval` it on graceful shutdown.
 */
export function startStatutoryFrequencyScheduler(
  intervalMs: number = DEFAULT_INTERVAL_MS,
  deps: StatutoryFrequencyCheckDeps = {},
): NodeJS.Timeout {
  const log = deps.logger ?? pino({ name: "meeting-statutory-frequency-check" });
  const tick = (): void => {
    void runStatutoryFrequencyCheck(deps).catch((err) => {
      log.error(
        { err: err instanceof Error ? err.stack : String(err) },
        "statutory-frequency-check: scheduler cycle failed",
      );
    });
  };
  const handle = setInterval(tick, intervalMs);
  // Do not keep the event loop alive solely for this timer.
  if (typeof handle.unref === "function") handle.unref();
  return handle;
}
