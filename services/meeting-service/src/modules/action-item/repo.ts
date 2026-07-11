/**
 * action-item module — cache-first DB reads (CQRS read side, task 11.3).
 *
 * This file is READ-ONLY: every write goes through the command publishers in commands.ts
 * (route → zod → queue.publish → 202) and is applied by consumer.ts. Reads follow the suite
 * rule "all reads through Redis cache" — served via `cache.getOrLoad` (keyed
 * `{service}:{tenant}:{resource}:{id}`) and invalidated by commands.ts / consumer.ts after a
 * write commits; the bounded TTL is the self-healing backstop for any missed invalidation.
 *
 * Cache keys owned here — ALL under the `action_item` resource prefix so the writers'
 * `cache.invalidateResource(tenant, "action_item")` (a prefix delete of
 * `meeting:{tenant}:action_item…`) sweeps every facet on any action-item write:
 *   - `action_item:{meetingId}`            → getActionItems (a meeting's action-item listing)
 *   - `action_item:my:{assigneeId}`        → getMyActions (an assignee's open + recent items, 60s)
 *   - `action_item:overdue`                → getOverdue tenant-wide (live figure, 60s TTL)
 *   - `action_item:overdue:{committeeId}`  → getOverdue scoped to a committee (60s TTL)
 *   - `action_item:atr:{committeeId}`      → getATR (compiled Action Taken Report, 60s TTL)
 *   - `action_item:{actionItemId}:history` → getProgressHistory (append-only progress log)
 *
 * Timestamps are normalised to ISO-8601 STRINGS in every returned DTO so a cache hit (which
 * deserialises stored JSON strings) and a cache miss (which would otherwise carry raw `Date`
 * objects off Drizzle) return the SAME shape — a read never drifts between hit and miss.
 *
 * Overdue derivation (Req 9.5, P21): `getOverdue` selects items whose `deadline` has passed AND
 * whose `status` is not settled (completed / verified / withdrawn) directly in SQL, matching the
 * pure `isOverdue` predicate in domain.ts. The stored `status` value (which the escalation worker
 * flips to `overdue`) is a separate concern from this live derivation, so an item surfaces here as
 * soon as its deadline lapses even before the sweep runs.
 *
 * ATR compilation (Req 10.1–10.4): `getATR` selects the committee's last N meetings (default 3,
 * Req 10.1), gathers their action items, and hands them to the pure `compileAtr` — which produces
 * the per-item entries, the summary statistics (total / on-time / late / overdue / withdrawn /
 * compliance %), the per-assignee breakdown, and the sub-70% compliance flag (Req 10.5).
 *
 * Ownership boundary (steering L2): this module owns `meeting.action_items` +
 * `meeting.action_progress`. The parent `meeting.meetings` (meeting-core) and `meeting.committees`
 * (committee) are read here tenant-scoped only as existence guards / ATR meeting selection, never
 * written. Existence guards read DIRECTLY (uncached) so the routes see live state for a 404.
 *
 * _Requirements: 9.1, 9.2, 9.7, 9.8, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_
 */
import { and, asc, desc, eq, inArray, notInArray, lt, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { meetings } from "../meeting-core/schema.js";
import { committees } from "../committee/schema.js";
import { actionItems, actionProgress, type ActionItemRow } from "./schema.js";
import {
  compileAtr,
  DEFAULT_ATR_MEETING_WINDOW,
  SETTLED_STATUSES,
  type CompiledAtr,
  type AtrSourceItem,
} from "./domain.js";

/** Cache resource prefix (shared invalidation contract with commands.ts + consumer.ts). */
const RESOURCE = "action_item";
/** "My actions" / "overdue" / ATR are live-ish figures — a short TTL bounds staleness (design). */
const LIVE_TTL_SECONDS = 60;

// ─── ISO helpers ────────────────────────────────────────────────────────────

/** ISO-8601 string for a timestamptz value, or null passthrough. */
function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

// ─── Read-model view (ISO-normalised) ─────────────────────────────────────────

/**
 * An action item as exposed by the read model — the `meeting.action_items` row with every
 * temporal column normalised to an ISO-8601 string (see file header). Includes `version` so the
 * write routes can default the optimistic-lock version for a PATCH.
 */
export interface ActionItemView {
  id: string;
  meetingId: string;
  decisionId: string | null;
  agendaItemId: string | null;
  description: string;
  assigneeId: string;
  deadline: string;
  priority: string;
  slaHours: number | null;
  escalationLevel: number;
  status: string;
  evidenceUrl: string | null;
  evidenceNote: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  completedAt: string | null;
  acknowledgedAt: string | null;
  overdueAt: string | null;
  nextEscalationAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/** Map a DB action-item row to its ISO-normalised read-model view. */
function toView(row: ActionItemRow): ActionItemView {
  return {
    id: row.id,
    meetingId: row.meetingId,
    decisionId: row.decisionId ?? null,
    agendaItemId: row.agendaItemId ?? null,
    description: row.description,
    assigneeId: row.assigneeId,
    deadline: toIso(row.deadline) as string,
    priority: row.priority,
    slaHours: row.slaHours ?? null,
    escalationLevel: row.escalationLevel,
    status: row.status,
    evidenceUrl: row.evidenceUrl ?? null,
    evidenceNote: row.evidenceNote ?? null,
    verifiedBy: row.verifiedBy ?? null,
    verifiedAt: toIso(row.verifiedAt),
    completedAt: toIso(row.completedAt),
    acknowledgedAt: toIso(row.acknowledgedAt),
    overdueAt: toIso(row.overdueAt),
    nextEscalationAt: toIso(row.nextEscalationAt),
    createdAt: toIso(row.createdAt) as string,
    updatedAt: toIso(row.updatedAt) as string,
    version: row.version,
  };
}

/** Map a DB row to the pure-domain ATR source shape (`compileAtr` input). */
function toAtrSource(row: ActionItemRow): AtrSourceItem {
  return {
    id: row.id,
    status: row.status,
    deadline: row.deadline,
    completedAt: row.completedAt ?? null,
    agendaItemId: row.agendaItemId ?? null,
    description: row.description,
    assigneeId: row.assigneeId,
    evidenceUrl: row.evidenceUrl ?? null,
    evidenceNote: row.evidenceNote ?? null,
  };
}

// ─── Existence guards (direct, uncached — for the routes' 404 handling) ───────

/** Minimal parent-meeting reference for the route existence guard + ATR selection. */
export interface MeetingRef {
  id: string;
  committeeId: string | null;
}

/**
 * Direct (uncached) meeting existence lookup, tenant-scoped. Returns null when the meeting is
 * unknown / belongs to another tenant so the routes answer 404 before publishing a command or
 * serving a listing. Owned by meeting-core; read here purely as a boundary guard.
 */
export async function getMeetingRef(tenantId: string, meetingId: string): Promise<MeetingRef | null> {
  const rows = await scopedRead((tx) => tx
    .select({ id: meetings.id, committeeId: meetings.committeeId })
    .from(meetings)
    .where(and(eq(meetings.id, meetingId), eq(meetings.tenantId, tenantId)))
    .limit(1));
  return rows[0] ?? null;
}

/** Minimal action-item reference for the mutate-route existence checks. */
export interface ActionItemRef {
  id: string;
  meetingId: string;
  assigneeId: string;
  status: string;
  version: number;
}

/**
 * Direct (uncached) single action-item lookup, tenant-scoped. Returns null when the item is
 * unknown / cross-tenant so the acknowledge/progress/evidence/verify/update/history routes answer
 * 404 before publishing a command. Uncached because it also supplies the current `version` for
 * an optimistic-locked write — a stale cached version would cause spurious 409s.
 */
export async function getActionItemRef(tenantId: string, actionItemId: string): Promise<ActionItemRef | null> {
  const rows = await scopedRead((tx) => tx
    .select({
      id: actionItems.id,
      meetingId: actionItems.meetingId,
      assigneeId: actionItems.assigneeId,
      status: actionItems.status,
      version: actionItems.version,
    })
    .from(actionItems)
    .where(and(eq(actionItems.id, actionItemId), eq(actionItems.tenantId, tenantId)))
    .limit(1));
  return rows[0] ?? null;
}

/** Live committee existence check (uncached), tenant-scoped. Used by the ATR route for 404. */
export async function committeeExists(tenantId: string, committeeId: string): Promise<boolean> {
  const rows = await scopedRead((tx) => tx
    .select({ id: committees.id })
    .from(committees)
    .where(and(eq(committees.id, committeeId), eq(committees.tenantId, tenantId)))
    .limit(1));
  return rows.length > 0;
}

// ─── getActionItems (Req 9.1) ─────────────────────────────────────────────────

/**
 * List a meeting's action items (Req 9.1), oldest → newest. Cache-first on
 * `action_item:{meetingId}` — the exact key the command publishers + consumer invalidate after
 * every action-item write. Tenant-scoped for RLS-compatible isolation (P29).
 */
export async function getActionItems(tenantId: string, meetingId: string): Promise<ActionItemView[]> {
  const rows = await cache.getOrLoad<ActionItemView[]>(
    cache.makeKey(tenantId, RESOURCE, meetingId),
    async () => {
      const found = await scopedRead((tx) => tx
        .select()
        .from(actionItems)
        .where(and(eq(actionItems.tenantId, tenantId), eq(actionItems.meetingId, meetingId)))
        .orderBy(asc(actionItems.createdAt)));
      return found.map(toView);
    },
  );
  return rows ?? [];
}

// ─── getMyActions (Req 9.x) ────────────────────────────────────────────────────

/**
 * List an assignee's action items (Req 9.x — "My assigned action items"), soonest deadline
 * first. Cache-first on `action_item:my:{assigneeId}` with a SHORT 60s TTL (design cache table).
 * Tenant-scoped (P29). Swept by the `action_item` prefix invalidation on any write.
 */
export async function getMyActions(tenantId: string, assigneeId: string): Promise<ActionItemView[]> {
  const rows = await cache.getOrLoad<ActionItemView[]>(
    cache.makeKey(tenantId, RESOURCE, `my:${assigneeId}`),
    async () => {
      const found = await scopedRead((tx) => tx
        .select()
        .from(actionItems)
        .where(and(eq(actionItems.tenantId, tenantId), eq(actionItems.assigneeId, assigneeId)))
        .orderBy(asc(actionItems.deadline)));
      return found.map(toView);
    },
    LIVE_TTL_SECONDS,
  );
  return rows ?? [];
}

// ─── getOverdue (Req 9.5, 10.x · P21) ───────────────────────────────────────────

/**
 * List overdue action items (Req 9.5, P21): `deadline < now()` AND `status` not settled
 * (completed / verified / withdrawn) — derived live in SQL so an item surfaces as soon as its
 * deadline lapses, independent of the escalation worker flipping the stored status. Optionally
 * scoped to a committee via a join on the parent meeting. Cache-first on `action_item:overdue`
 * (tenant-wide) or `action_item:overdue:{committeeId}` with a SHORT 60s TTL (live figure).
 * Ordered by most-overdue first (earliest deadline). Tenant-scoped (P29).
 */
export async function getOverdue(tenantId: string, committeeId?: string): Promise<ActionItemView[]> {
  const cacheId = committeeId ? `overdue:${committeeId}` : "overdue";
  const rows = await cache.getOrLoad<ActionItemView[]>(
    cache.makeKey(tenantId, RESOURCE, cacheId),
    async () => {
      const overdueCondition = and(
        eq(actionItems.tenantId, tenantId),
        lt(actionItems.deadline, sql`now()`),
        notInArray(actionItems.status, [...SETTLED_STATUSES]),
      );
      if (committeeId) {
        const found = await scopedRead((tx) => tx
          .select({ item: actionItems })
          .from(actionItems)
          .innerJoin(meetings, eq(actionItems.meetingId, meetings.id))
          .where(and(overdueCondition, eq(meetings.committeeId, committeeId)))
          .orderBy(asc(actionItems.deadline)));
        return found.map((r) => toView(r.item));
      }
      const found = await scopedRead((tx) => tx
        .select()
        .from(actionItems)
        .where(overdueCondition)
        .orderBy(asc(actionItems.deadline)));
      return found.map(toView);
    },
    LIVE_TTL_SECONDS,
  );
  return rows ?? [];
}

// ─── getATR (Req 10.1–10.5) ─────────────────────────────────────────────────────

/** A compiled Action Taken Report plus the committee/meeting context it was built from. */
export interface AtrReport extends CompiledAtr {
  committeeId: string;
  /** Number of prior meetings the ATR drew from (Req 10.1, default 3). */
  meetingWindow: number;
  /** The meeting ids whose action items were compiled (newest → oldest). */
  meetingIds: string[];
}

/**
 * Generate a committee's Action Taken Report (Req 10.1–10.5). Selects the committee's last
 * `window` meetings (default {@link DEFAULT_ATR_MEETING_WINDOW}, newest by scheduled time),
 * gathers their action items, and compiles them with the pure `compileAtr` — yielding the
 * per-item entries, summary statistics (total / on-time / late / overdue / withdrawn /
 * compliance %), the per-assignee breakdown, and the sub-70% compliance flag (Req 10.5).
 * Cache-first on `action_item:atr:{committeeId}:{window}` — the meeting window is part of the key
 * so different report spans don't collide — with a 60s TTL (compliance shifts as items settle).
 * Tenant-scoped (P29). Callers 404 (via {@link committeeExists}) before invoking.
 */
export async function getATR(
  tenantId: string,
  committeeId: string,
  window: number = DEFAULT_ATR_MEETING_WINDOW,
): Promise<AtrReport> {
  const meetingWindow = Number.isFinite(window) && window > 0 ? Math.trunc(window) : DEFAULT_ATR_MEETING_WINDOW;
  const report = await cache.getOrLoad<AtrReport>(
    cache.makeKey(tenantId, RESOURCE, `atr:${committeeId}:${meetingWindow}`),
    async () => {
      // Req 10.1: the committee's last N meetings (newest scheduled first).
      const recentMeetings = await scopedRead((tx) => tx
        .select({ id: meetings.id })
        .from(meetings)
        .where(and(eq(meetings.tenantId, tenantId), eq(meetings.committeeId, committeeId)))
        .orderBy(desc(meetings.scheduledAt))
        .limit(meetingWindow));
      const meetingIds = recentMeetings.map((m) => m.id);

      const now = new Date();
      if (meetingIds.length === 0) {
        return { ...compileAtr([], now), committeeId, meetingWindow, meetingIds };
      }

      const items = await scopedRead((tx) => tx
        .select()
        .from(actionItems)
        .where(and(eq(actionItems.tenantId, tenantId), inArray(actionItems.meetingId, meetingIds))));
      const compiled = compileAtr(items.map(toAtrSource), now);
      return { ...compiled, committeeId, meetingWindow, meetingIds };
    },
    LIVE_TTL_SECONDS,
  );
  // getOrLoad only returns null for a null loader result; compileAtr always returns an object.
  return report ?? { ...compileAtr([], new Date()), committeeId, meetingWindow, meetingIds: [] };
}

// ─── getProgressHistory (Req 10.2) ──────────────────────────────────────────────

/** One append-only progress note on an action item (Req 10.2). */
export interface ProgressEntry {
  id: string;
  actionItemId: string;
  updateText: string;
  percentage: number;
  updatedBy: string;
  createdAt: string;
}

/**
 * The append-only progress history for an action item (Req 10.2), oldest → newest. Cache-first on
 * `action_item:{actionItemId}:history` (swept by the `action_item` prefix invalidation on any
 * write). Tenant-scoped (P29). Callers 404 (via {@link getActionItemRef}) before invoking.
 */
export async function getProgressHistory(tenantId: string, actionItemId: string): Promise<ProgressEntry[]> {
  const rows = await cache.getOrLoad<ProgressEntry[]>(
    cache.makeKey(tenantId, RESOURCE, `${actionItemId}:history`),
    async () => {
      const found = await scopedRead((tx) => tx
        .select()
        .from(actionProgress)
        .where(and(eq(actionProgress.tenantId, tenantId), eq(actionProgress.actionItemId, actionItemId)))
        .orderBy(asc(actionProgress.createdAt)));
      return found.map((r) => ({
        id: r.id,
        actionItemId: r.actionItemId,
        updateText: r.updateText,
        percentage: r.percentage,
        updatedBy: r.updatedBy,
        createdAt: toIso(r.createdAt) as string,
      }));
    },
  );
  return rows ?? [];
}
