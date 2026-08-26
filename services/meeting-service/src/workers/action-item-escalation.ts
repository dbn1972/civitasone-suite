/**
 * Scheduled worker — action-item escalation sweep (Req 9.4, 9.5, 9.6).
 *
 * An action item that has passed its deadline without being settled must climb a configurable
 * escalation chain so accountability does not stall: Level 1 (deadline + 24h → supervisor),
 * Level 2 (deadline + 72h → department head), Level 3 (deadline + 7d → chairperson). This worker
 * runs every 15 MINUTES, scans every overdue action item whose next escalation trigger has fired
 * (`deadline < now AND status NOT IN (completed, verified, withdrawn) AND next_escalation_at <
 * now`), and — per item, inside its tenant context — advances the escalation level, re-anchors the
 * following trigger, flips the status to `escalated`, and emits `meeting.action_item.escalated`
 * plus the chain notification(s) + an audit fact via the transactional outbox.
 *
 * Design notes
 * ────────────
 * • Reuses the module's pure domain chain (action-item/domain.ts) as the single source of truth
 *   for escalation semantics — `resolveEscalationState` (which itself composes
 *   `computeEscalationLevel` + `nextEscalationAt` and guards P20 monotonicity), `escalationTarget`,
 *   `isOverdue`, and `isSettledStatus`. The worker owns NO escalation arithmetic of its own; the
 *   planner (`planEscalations`) is a thin, deterministic projection over those functions given an
 *   injected `now`, and is exhaustively unit-tested with no clock/I/O coupling.
 *
 * • Cross-tenant scan, per-tenant write: the candidate scan reads action items across all tenants
 *   (mirroring the outbox relay's cross-tenant sweep and the sibling statutory/tenure workers).
 *   Every WRITE (optimistic-locked status update + outbox enqueue) runs inside
 *   `runWithTenant(tenantId, …)` so the per-transaction `app.tenant_id` GUC is set and RLS /
 *   tenant isolation holds end-to-end (steering: multi-tenant isolation).
 *
 * • Monotonic + idempotent: the level only ever climbs (`resolveEscalationState` clamps to
 *   `max(current, computed)`), and the write is optimistic-locked on the row's `version` — a
 *   concurrent mutation surfaces as a `VersionConflictError`, is counted as a failure, and is
 *   retried on the next tick. Because the scan re-filters on `next_escalation_at < now`, an item
 *   already advanced by a competing writer produces no further escalation on a later run.
 *
 * • Chain recipient resolution: the chairperson (Level 3) is named directly from the meeting; the
 *   supervisor / department head (Levels 1–2) are resolved downstream by notification-service from
 *   the assignee via the event's `notify` role (HRMS-driven routing), so no HR graph is walked
 *   here. This mirrors action-item/consumer.ts `handleEscalate` exactly.
 *
 * • Dependency seams: `runActionItemEscalation` accepts injectable `loadCandidates` + `emit` so the
 *   orchestration is testable without a live database. Production defaults bind to the real Drizzle
 *   client + transactional outbox.
 *
 * • Runnable entrypoint: `runActionItemEscalation` is exported for worker.ts (task 19.1) to
 *   schedule; `startActionItemEscalationScheduler` starts the 15-minute cadence and never rethrows
 *   (a failing cycle is logged and the loop continues), returning the interval handle so the worker
 *   entrypoint can `clearInterval` it on graceful shutdown. The timer is `unref`ed so it never
 *   keeps the event loop alive on its own.
 *
 * _Requirements: 9.4, 9.5, 9.6_
 */
import { randomUUID } from "node:crypto";
import { pino, type Logger } from "pino";
import { and, eq, inArray, isNotNull, lt, notInArray } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { NOTIFICATION_SEND, buildNotificationPayload } from "@civitasone/events";
import { db as defaultDb } from "../shared/db.js";
import { scannerDb } from "../shared/scanner-db.js";
import { cache } from "../shared/infra.js";
import { enqueue, versionedUpdate, type DrizzleTx } from "../shared/outbox.js";
import { EVENTS, SERVICE } from "../topics.js";
import { actionItems } from "../modules/action-item/schema.js";
import { meetings } from "../modules/meeting-core/schema.js";
import { loadNamespaceOverrides } from "../modules/config-registry/repo.js";
import { resolveEscalationChain, POLICY_NS } from "../modules/config-registry/policy.js";
import {
  DEFAULT_ESCALATION_CHAIN,
  SETTLED_STATUSES,
  isOverdue,
  isSettledStatus,
  resolveEscalationState,
  type EscalationRung,
  type EscalationTarget,
} from "../modules/action-item/domain.js";

const AUDIT_TOPIC = "audit.event.record";
const CACHE_RESOURCE = "action_item";

/** Nil-UUID actor for system-initiated (cron) writes — carries no human actor. */
export const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

/** Default cadence for the scheduler: every 15 minutes (Req 9.5, 9.6 — SLA-breach sweep). */
export const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

// ─── Candidate + action models ───────────────────────────────────────────────

/**
 * An overdue action item eligible for an escalation check, as read from the DB (joined with its
 * meeting for the chairperson/secretary recipients). The scan pre-filters to
 * `deadline < now AND status NOT IN settled AND next_escalation_at < now`; the planner re-derives
 * the target level from the domain chain as the authoritative decision.
 */
export interface EscalationCandidate {
  actionItemId: string;
  tenantId: string;
  meetingId: string;
  assigneeId: string;
  deadline: Date;
  /** Prior overdue anchor, if any — preserved so the first overdue instant is not overwritten. */
  overdueAt: Date | null;
  escalationLevel: number;
  status: string;
  /** Row version for the optimistic-locked escalation write. */
  version: number;
  /** Meeting chairperson (Level-3 recipient), or null when unresolved. */
  chairpersonId: string | null;
  /** Meeting secretary (coordinating-officer fallback recipient), or null when unresolved. */
  secretaryId: string | null;
}

/** A resolved escalation to apply to a single action item (level advanced from `fromLevel`). */
export interface EscalationAction {
  candidate: EscalationCandidate;
  /** The item's escalation level before this sweep. */
  fromLevel: number;
  /** The level to advance to (strictly greater than `fromLevel` — P20 monotonic). */
  toLevel: number;
  /** Who the newly reached rung notifies (Req 9.6), or null when the chain names no target. */
  notify: EscalationTarget | null;
  /** Nameable recipient ids for the rung (chairperson at L3, else the meeting secretary). */
  notifyIds: string[];
  /** When the following (un-fired) rung fires, or null at the top of the chain. */
  nextEscalationAt: Date | null;
}

// ─── Pure planning (no I/O, fully testable) ────────────────────────────────────

/**
 * Project a set of overdue candidates into the escalations to apply (pure, Req 9.5, 9.6).
 *
 * For each candidate the target level is derived from the domain chain via
 * `resolveEscalationState` (monotonic — never below the current level, P20). A candidate is
 * included only when the level actually advances (`escalated === true`); items whose deadline has
 * not yet lapsed far enough, or that are already at the level their overdue window implies, are
 * skipped as no-ops. Settled / non-overdue items are defensively excluded even though the scan
 * predicate should already have filtered them.
 *
 * The Level-3 chairperson is named directly; for Levels 1–2 the coordinating meeting secretary is
 * named as a resolvable recipient (the supervisor / department head is resolved downstream by
 * notification-service from the assignee via the event `notify` role). This mirrors
 * action-item/consumer.ts `handleEscalate`.
 */
export function planEscalations(
  candidates: readonly EscalationCandidate[],
  now: Date,
  chain: readonly EscalationRung[] = DEFAULT_ESCALATION_CHAIN,
): EscalationAction[] {
  const actions: EscalationAction[] = [];
  for (const c of candidates) {
    // Defensive guards — the scan predicate should already exclude these.
    if (isSettledStatus(c.status)) continue;
    if (!isOverdue({ deadline: c.deadline, status: c.status, now })) continue;

    const state = resolveEscalationState({
      deadline: c.deadline,
      currentLevel: c.escalationLevel,
      now,
      chain,
    });
    if (!state.escalated) continue; // level did not advance → nothing to do this tick

    const notifyIds: string[] = [];
    if (state.notify === "chairperson" && c.chairpersonId) notifyIds.push(c.chairpersonId);
    else if (c.secretaryId) notifyIds.push(c.secretaryId);

    actions.push({
      candidate: c,
      fromLevel: c.escalationLevel,
      toLevel: state.level,
      notify: state.notify,
      notifyIds,
      nextEscalationAt: state.nextEscalationAt,
    });
  }
  return actions;
}

// ─── Outbox message construction (pure) ────────────────────────────────────────

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
 * Build the outbox messages for one escalation (pure, Req 9.5, 9.6, 16.2):
 *   1. `meeting.action_item.escalated` — the canonical escalation fact
 *      (payload per topics.ts: `{ actionItemId, meetingId, assigneeId, toLevel, notifyIds }`,
 *      plus the `notify` role so notification-service can resolve the supervisor / department head
 *      from the assignee for Levels 1–2). Consumed by notification-service + dashboards.
 *   2. one `notification.send` to the assignee — always alerted their action escalated (Req 9.5).
 *   3. one `notification.send` per nameable chain recipient (chairperson at L3, else secretary).
 *   4. an `audit.event.record` fact — CERT-In structured audit on every mutation (Req 16.2).
 *
 * Notification `variables` carry only non-PII entity ids / metadata (steering: NEVER emit PII).
 */
export function buildEscalationMessages(
  action: EscalationAction,
  meta: { actorId: string; correlationId: string },
): OutboxMessageInput[] {
  const { candidate: c } = action;
  const base = {
    tenantId: c.tenantId,
    actorId: meta.actorId,
    correlationId: meta.correlationId,
  };

  const messages: OutboxMessageInput[] = [];

  // (1) Canonical escalation event.
  messages.push({
    ...base,
    topic: EVENTS.actionItemEscalated,
    eventType: EVENTS.actionItemEscalated,
    payload: {
      actionItemId: c.actionItemId,
      meetingId: c.meetingId,
      assigneeId: c.assigneeId,
      toLevel: action.toLevel,
      ...(action.notify ? { notify: action.notify } : {}),
      notifyIds: action.notifyIds,
    },
  });

  const variables: Record<string, string> = {
    actionItemId: c.actionItemId,
    toLevel: String(action.toLevel),
  };

  // (2) Assignee notification.
  messages.push({
    ...base,
    topic: NOTIFICATION_SEND,
    eventType: NOTIFICATION_SEND,
    payload: buildNotificationPayload({
      eventType: EVENTS.actionItemEscalated,
      recipient: c.assigneeId,
      recipientId: c.assigneeId,
      channel: "in_app",
      variables,
    }) as unknown as Record<string, unknown>,
  });

  // (3) Chain-recipient notification(s).
  for (const recipientId of action.notifyIds) {
    messages.push({
      ...base,
      topic: NOTIFICATION_SEND,
      eventType: NOTIFICATION_SEND,
      payload: buildNotificationPayload({
        eventType: EVENTS.actionItemEscalated,
        recipient: recipientId,
        recipientId,
        channel: "in_app",
        variables,
      }) as unknown as Record<string, unknown>,
    });
  }

  // (4) Audit fact (CERT-In, Req 16.2).
  messages.push({
    ...base,
    topic: AUDIT_TOPIC,
    eventType: AUDIT_TOPIC,
    payload: {
      service: SERVICE,
      action: "escalate",
      resourceType: "action_item",
      resourceId: c.actionItemId,
      outcome: "success",
      metadata: { fromLevel: action.fromLevel, toLevel: action.toLevel },
    },
  });

  return messages;
}

// ─── Orchestration ─────────────────────────────────────────────────────────────

/** Injectable dependencies for the worker (production defaults bind to the real db/outbox). */
export interface ActionItemEscalationDeps {
  /** Reference instant; defaults to `new Date()`. Drives the overdue / escalation derivation. */
  now?: Date;
  /**
   * Escalation chain override (defaults to the module's `DEFAULT_ESCALATION_CHAIN`). Explicitly
   * setting this is an ESCAPE HATCH that forces one flat chain for every candidate in the sweep
   * and bypasses config-registry resolution entirely (kept for tests / callers that want full
   * manual control). Leave unset in production so the chain is resolved PER TENANT from
   * config-registry (`action_item.escalation_l1_hours` / `l2` / `l3`, via
   * `resolveEscalationChain`, falling back to `DEFAULT_ESCALATION_CHAIN` for any tenant that has
   * configured nothing — behavior-preserving when unconfigured).
   */
  chain?: readonly EscalationRung[];
  /** Pino logger (defaults to a module logger). */
  logger?: Logger;
  /** Cross-tenant scan of overdue action items whose next escalation trigger has fired. */
  loadCandidates?: (now: Date) => Promise<EscalationCandidate[]>;
  /** Apply one escalation (optimistic-locked write + outbox) inside its tenant context. */
  emit?: (action: EscalationAction, messages: OutboxMessageInput[]) => Promise<void>;
  /** Cross-tenant config-registry override load (default: the real BYPASSRLS scanner read). */
  loadOverrides?: () => Promise<Map<string, Map<string, unknown>>>;
}

/**
 * Default cross-tenant config-registry override load (schema/migration review finding:
 * worker-path policy overrides were dead code, with zero call sites in any scheduled worker —
 * a tenant-configured escalation chain silently never took effect). Same BYPASSRLS scanner
 * pool as the candidate scan below.
 */
async function defaultLoadOverrides(): Promise<Map<string, Map<string, unknown>>> {
  return loadNamespaceOverrides(scannerDb, POLICY_NS);
}

/** Summary of a single worker run. */
export interface ActionItemEscalationResult {
  /** Overdue candidates scanned (next_escalation_at already fired). */
  scanned: number;
  /** Candidates whose escalation level advanced this sweep. */
  escalated: number;
  /** Escalations whose write/emit failed (isolated + counted; retried next run). */
  failed: number;
}

/**
 * Run one action-item escalation sweep (Req 9.4, 9.5, 9.6).
 *
 * Runnable entrypoint for worker.ts (task 19.1) to schedule every 15 minutes. Scans all overdue
 * action items whose next escalation trigger has fired, plans the level advances via the domain
 * chain, and — per escalation, inside its tenant context — advances the level + status and emits
 * the escalation event + chain notification(s) + audit fact via the transactional outbox. A
 * per-item failure is logged and counted but never aborts the whole sweep.
 */
export async function runActionItemEscalation(
  deps: ActionItemEscalationDeps = {},
): Promise<ActionItemEscalationResult> {
  const now = deps.now ?? new Date();
  const log = deps.logger ?? pino({ name: "meeting-action-item-escalation" });
  const loadCandidates = deps.loadCandidates ?? defaultLoadCandidates;
  const emit = deps.emit ?? defaultEmit;
  const loadOverrides = deps.loadOverrides ?? defaultLoadOverrides;

  const candidates = await loadCandidates(now);

  // An explicit deps.chain forces one flat chain for every candidate and skips config
  // resolution entirely (escape hatch — see the ActionItemEscalationDeps doc comment).
  // Otherwise resolve PER TENANT from config-registry so a tenant-configured escalation chain
  // actually takes effect instead of silently being ignored, which is the bug this wiring
  // closes. The FIRST next_escalation_at trigger for a new/updated action item is seeded by
  // action-item/consumer.ts, which now resolves the SAME tenant chain on its GUC-scoped tx
  // (config-registry getEscalationChain); this worker's own re-anchoring of subsequent rungs
  // (below, via planEscalations' derived nextEscalationAt) uses the tenant-resolved chain too,
  // so every rung — the first trigger included — honors the tenant's configured windows.
  let actions: EscalationAction[];
  if (deps.chain) {
    actions = planEscalations(candidates, now, deps.chain);
  } else {
    const overrides = await loadOverrides();
    const byTenant = new Map<string, EscalationCandidate[]>();
    for (const c of candidates) {
      const list = byTenant.get(c.tenantId);
      if (list) list.push(c);
      else byTenant.set(c.tenantId, [c]);
    }
    actions = [];
    for (const [tenantId, tenantCandidates] of byTenant) {
      const tenantChain = resolveEscalationChain(overrides, tenantId);
      actions.push(...planEscalations(tenantCandidates, now, tenantChain));
    }
  }

  let escalated = 0;
  let failed = 0;
  for (const action of actions) {
    const correlationId = `action-item-escalation-${randomUUID()}`;
    try {
      const messages = buildEscalationMessages(action, { actorId: SYSTEM_ACTOR_ID, correlationId });
      await emit(action, messages);
      escalated += 1;
      log.info(
        {
          actionItemId: action.candidate.actionItemId,
          tenantId: action.candidate.tenantId,
          fromLevel: action.fromLevel,
          toLevel: action.toLevel,
          notify: action.notify,
          recipients: action.notifyIds.length,
        },
        "action item escalated — escalation event emitted",
      );
    } catch (err) {
      // Isolate per-item failures (e.g. optimistic-lock conflict) so one bad row never stalls the sweep.
      failed += 1;
      log.error(
        {
          actionItemId: action.candidate.actionItemId,
          tenantId: action.candidate.tenantId,
          err: err instanceof Error ? err.stack : String(err),
        },
        "failed to apply action-item escalation",
      );
    }
  }

  const result: ActionItemEscalationResult = { scanned: candidates.length, escalated, failed };
  log.info({ ...result, now: now.toISOString() }, "action-item escalation sweep complete");
  return result;
}

// ─── Production data-access defaults ─────────────────────────────────────────────

/**
 * Cross-tenant scan of overdue action items whose next escalation trigger has fired
 * (`deadline < now AND status NOT IN (completed, verified, withdrawn) AND
 * next_escalation_at IS NOT NULL AND next_escalation_at < now`). Reads across tenants (like the
 * outbox relay); the tenant GUC is applied on the per-tenant WRITE path, not this maintenance scan.
 *
 * The chairperson / secretary recipients are resolved with a second, batched lookup over the
 * distinct meeting ids (rather than a cross-module JOIN) so module isolation is preserved and the
 * scan stays N+1-free.
 */
async function defaultLoadCandidates(now: Date): Promise<EscalationCandidate[]> {
  // Cross-tenant scan via BYPASSRLS scanner pool (migration 0007) — see scanner-db.ts.
  const itemRows = await scannerDb
    .select({
      actionItemId: actionItems.id,
      tenantId: actionItems.tenantId,
      meetingId: actionItems.meetingId,
      assigneeId: actionItems.assigneeId,
      deadline: actionItems.deadline,
      overdueAt: actionItems.overdueAt,
      escalationLevel: actionItems.escalationLevel,
      status: actionItems.status,
      version: actionItems.version,
    })
    .from(actionItems)
    .where(
      and(
        lt(actionItems.deadline, now),
        notInArray(actionItems.status, [...SETTLED_STATUSES]),
        isNotNull(actionItems.nextEscalationAt),
        lt(actionItems.nextEscalationAt, now),
      ),
    );

  if (itemRows.length === 0) return [];

  const meetingIds = [...new Set(itemRows.map((r) => r.meetingId))];
  const meetingRows = await scannerDb
    .select({
      id: meetings.id,
      chairpersonId: meetings.chairpersonId,
      secretaryId: meetings.secretaryId,
    })
    .from(meetings)
    .where(inArray(meetings.id, meetingIds));

  const byMeeting = new Map(meetingRows.map((m) => [m.id, m]));

  return itemRows.map((r) => {
    const meeting = byMeeting.get(r.meetingId);
    return {
      actionItemId: r.actionItemId,
      tenantId: r.tenantId,
      meetingId: r.meetingId,
      assigneeId: r.assigneeId,
      deadline: r.deadline,
      overdueAt: r.overdueAt ?? null,
      escalationLevel: r.escalationLevel,
      status: r.status,
      version: r.version,
      chairpersonId: meeting?.chairpersonId ?? null,
      secretaryId: meeting?.secretaryId ?? null,
    };
  });
}

/**
 * Apply one escalation inside the row's tenant scope: an optimistic-locked UPDATE advancing the
 * escalation level + `escalated` status + re-anchored `next_escalation_at` (preserving the first
 * `overdue_at`), followed by the outbox messages (event + notification(s) + audit) — all in one
 * transaction so "DB committed ⇒ events delivered" with no dual-write hole. The read caches are
 * invalidated after commit. Throws `VersionConflictError` on a concurrent modification so the
 * caller counts it as a failure and the next run retries.
 */
async function defaultEmit(action: EscalationAction, messages: OutboxMessageInput[]): Promise<void> {
  const { candidate: c } = action;
  await runWithTenant(c.tenantId, async () => {
    await defaultDb.transaction(async (tx: DrizzleTx) => {
      await versionedUpdate(tx, actionItems, {
        id: c.actionItemId,
        tenantId: c.tenantId,
        expectedVersion: c.version,
        set: {
          escalationLevel: action.toLevel,
          status: "escalated",
          overdueAt: c.overdueAt ?? c.deadline,
          nextEscalationAt: action.nextEscalationAt,
          updatedBy: SYSTEM_ACTOR_ID,
          updatedAt: new Date(),
        },
        entity: "action_item",
      });
      for (const message of messages) {
        await enqueue(tx, message);
      }
    });
  });
  await cache.invalidate(cache.makeKey(c.tenantId, CACHE_RESOURCE, c.actionItemId));
  await cache.invalidate(cache.makeKey(c.tenantId, CACHE_RESOURCE, c.meetingId));
  await cache.invalidateResource(c.tenantId, CACHE_RESOURCE);
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

/**
 * Start the 15-minute action-item escalation scheduler. Runs `runActionItemEscalation` every
 * `intervalMs` (default 15 min) and never rethrows — a failing cycle is logged and the loop
 * continues (mirrors `startOutboxPurge`/`startRelay` and the sibling statutory/tenure schedulers).
 * Returns the interval handle so worker.ts (task 19.1) can `clearInterval` it on graceful shutdown.
 */
export function startActionItemEscalationScheduler(
  intervalMs: number = DEFAULT_INTERVAL_MS,
  deps: ActionItemEscalationDeps = {},
): NodeJS.Timeout {
  const log = deps.logger ?? pino({ name: "meeting-action-item-escalation" });
  const tick = (): void => {
    void runActionItemEscalation(deps).catch((err) => {
      log.error(
        { err: err instanceof Error ? err.stack : String(err) },
        "action-item-escalation: scheduler cycle failed",
      );
    });
  };
  const handle = setInterval(tick, intervalMs);
  // Do not keep the event loop alive solely for this timer.
  if (typeof handle.unref === "function") handle.unref();
  return handle;
}
