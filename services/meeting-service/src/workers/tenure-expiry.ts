/**
 * meeting-service — tenure-expiry notification worker (scheduled, Req 2.4).
 *
 * A daily cron job that keeps committee membership tenure honest:
 *
 *   1. Advance notice — for every ACTIVE membership whose tenure ends within the
 *      advance-notice window (default 30 days) BUT has not yet lapsed, emit
 *      `committee.tenure_expiring` so the Notification_Service can alert the
 *      constituting authority 30 days in advance (Req 2.4, first clause).
 *   2. Expiry transition — for every ACTIVE membership whose tenure_end has
 *      arrived (today) or already passed, flip the membership to `expired`
 *      (optimistic-locked status update) and emit `committee.member_expired`
 *      (Req 2.4, second clause). Past-dated rows are handled too, so a missed
 *      cron tick self-heals on the next run.
 *
 * Design notes:
 *   • The decision logic (`classifyTenure`, `planTenureActions`) is PURE — no clock,
 *     no I/O — so the tenure-window detection and the expiry transition are fully
 *     unit-testable without a database (see tests/tenure-expiry.test.ts).
 *   • The runnable side (`runTenureExpiryWorker`) is a thin orchestrator over an
 *     injectable ports object (`TenureExpiryDeps`); worker.ts schedules it via
 *     `startTenureExpiryScheduler`. Tests inject in-memory ports to exercise the
 *     orchestration end-to-end without touching Postgres.
 *   • Cross-tenant scan: this is a trusted system process, so the discovery query
 *     intentionally spans all tenants (no `app.tenant_id` scope). Each per-tenant
 *     WRITE is then wrapped in `runWithTenant(tenantId, …)` so the RLS GUC backstop
 *     is set correctly and events carry the row's own tenantId (tenant isolation
 *     preserved end-to-end). Mirrors how the outbox relay operates cross-tenant.
 *   • Every mutation goes through the transactional outbox (event + audit in the
 *     same tx as the status write) — no dual-write hole (steering: CQRS + Outbox).
 *
 * _Requirements: 2.4_
 */
import { randomUUID } from "node:crypto";
import { pino, type Logger } from "pino";
import { and, eq, isNotNull, lte } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db } from "../shared/db.js";
import { scannerDb } from "../shared/scanner-db.js";
import { cache } from "../shared/infra.js";
import { enqueue, versionedUpdate } from "../shared/outbox.js";
import { EVENTS, SERVICE } from "../topics.js";
import { committeeMembers } from "../modules/committee/schema.js";
import { daysUntilTenureEnd } from "../modules/committee/domain.js";
import { loadNamespaceOverrides } from "../modules/config-registry/repo.js";
import { resolveNumber, POLICY_NS } from "../modules/config-registry/policy.js";

const AUDIT_TOPIC = "audit.event.record";
const CACHE_RESOURCE = "committee";
/**
 * Actor id stamped on system-generated events/audit rows (no human triggers a cron).
 * A canonical all-zeros UUID keeps the `actor_id uuid` column valid + greppable.
 */
export const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
/** Advance-notice window before tenure_end (Req 2.4): alert 30 days ahead. */
export const DEFAULT_ADVANCE_NOTICE_DAYS = 30;
/** Default cadence for the scheduler: once per day. */
export const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;

// ─── Pure decision logic (no I/O, fully testable) ─────────────────────────────

/** How a membership's tenure relates to "today" for the worker's purposes. */
export type TenureStatus = "expired" | "expiring" | "none";

/** The subset of a committee_members row the worker needs to act on a membership. */
export interface MembershipRow {
  id: string;
  tenantId: string;
  committeeId: string;
  memberId: string;
  /** ISO `YYYY-MM-DD`; the scan filters out null (open-ended) tenures. */
  tenureEnd: string;
  version: number;
  status: string;
}

/** The set of actions a single cron run should apply, partitioned by kind. */
export interface TenurePlan {
  /** Active memberships on/past their tenure_end → transition to `expired`. */
  expiries: MembershipRow[];
  /** Active memberships expiring within the notice window (but not yet lapsed). */
  expiringNotices: MembershipRow[];
}

/**
 * Classify a tenure against `today` (both ISO `YYYY-MM-DD`).
 *
 *   • `expired`  — tenure_end is today or earlier (`daysUntilTenureEnd <= 0`). Per Req 2.4
 *                  the membership is marked expired ON the tenure_end date; earlier
 *                  (past-dated) rows are swept up too so a missed run self-heals.
 *   • `expiring` — tenure_end is strictly after today and within `withinDays`
 *                  (`0 < days <= withinDays`) → advance-notice window.
 *   • `none`     — open-ended tenure (null) or further out than the window.
 */
export function classifyTenure(
  tenureEnd: string | null,
  today: string,
  withinDays = DEFAULT_ADVANCE_NOTICE_DAYS,
): TenureStatus {
  const days = daysUntilTenureEnd(tenureEnd, today);
  if (days === null) return "none";
  if (days <= 0) return "expired";
  if (days <= withinDays) return "expiring";
  return "none";
}

/**
 * Partition a set of scanned membership rows into expiry transitions and
 * advance-notice emissions. Pure — this is the core "tenure-window detection +
 * expiry transition" decision the worker applies.
 */
export function planTenureActions(
  rows: readonly MembershipRow[],
  today: string,
  withinDays = DEFAULT_ADVANCE_NOTICE_DAYS,
): TenurePlan {
  const expiries: MembershipRow[] = [];
  const expiringNotices: MembershipRow[] = [];
  for (const row of rows) {
    switch (classifyTenure(row.tenureEnd, today, withinDays)) {
      case "expired":
        expiries.push(row);
        break;
      case "expiring":
        expiringNotices.push(row);
        break;
      default:
        break;
    }
  }
  return { expiries, expiringNotices };
}

// ─── Date helpers ──────────────────────────────────────────────────────────────

/** ISO `YYYY-MM-DD` for an instant, in UTC (matches the `date` columns). */
export function toIsoDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Add `days` to an ISO `YYYY-MM-DD` date using UTC calendar arithmetic. */
export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ─── Injectable I/O ports ────────────────────────────────────────────────────

/** Outcome summary returned by a single worker run (used for logging + tests). */
export interface TenureExpiryResult {
  scanned: number;
  expired: number;
  expiring: number;
  failed: number;
}

/**
 * Ports the runner depends on. All default to the real Postgres/queue-backed
 * implementations; tests override them with in-memory fakes to exercise the
 * orchestration without a database.
 */
export interface TenureExpiryDeps {
  /** Clock — defaults to the real current instant. */
  now?: Date;
  /**
   * Advance-notice window in days (default 30). Explicitly setting this is an ESCAPE HATCH
   * that forces one flat window for the whole run and bypasses config-registry resolution
   * entirely (kept for tests / callers that want full manual control). Leave unset in
   * production so the window is resolved PER TENANT from config-registry
   * (`committee.tenure_advance_notice_days`, falling back to `DEFAULT_ADVANCE_NOTICE_DAYS` for
   * any tenant that has configured nothing — behavior-preserving when unconfigured).
   */
  withinDays?: number;
  /** Discover ACTIVE memberships whose tenure_end is on/before `cutoffIso`. */
  scan?: (cutoffIso: string) => Promise<MembershipRow[]>;
  /** Apply the `expired` transition + emit `committee.member_expired`. */
  expireMembership?: (row: MembershipRow, correlationId: string) => Promise<void>;
  /** Emit `committee.tenure_expiring` advance notice. */
  notifyExpiring?: (row: MembershipRow, correlationId: string) => Promise<void>;
  /** Cross-tenant config-registry override load (default: the real BYPASSRLS scanner read). */
  loadOverrides?: () => Promise<Map<string, Map<string, unknown>>>;
  /** Logger (defaults to a named pino logger). */
  logger?: Logger;
}

/**
 * Default cross-tenant config-registry override load (schema/migration review finding:
 * worker-path policy overrides — `loadNamespaceOverrides` / `resolveNumber` — were dead code,
 * with zero call sites in any scheduled worker, so a tenant-configured
 * `committee.tenure_advance_notice_days` silently never took effect). Same BYPASSRLS scanner
 * pool as the membership scan below.
 */
async function defaultLoadOverrides(): Promise<Map<string, Map<string, unknown>>> {
  return loadNamespaceOverrides(scannerDb, POLICY_NS);
}

/**
 * Default scan: ACTIVE memberships with a non-null tenure_end on or before the
 * 30-day cutoff, across ALL tenants (trusted system process). Selects the columns
 * the worker needs, including `version` for the optimistic-locked expiry write.
 */
async function defaultScan(cutoffIso: string): Promise<MembershipRow[]> {
  // Cross-tenant discovery via the BYPASSRLS scanner pool (migration 0007). Under
  // FORCE RLS as meeting_svc (NOBYPASSRLS) a bare db.select() with no tenant GUC
  // returns ZERO rows — so this SELECT MUST use scannerDb. Writes below stay on the
  // primary db inside runWithTenant(row.tenantId, …).
  return scannerDb
    .select({
      id: committeeMembers.id,
      tenantId: committeeMembers.tenantId,
      committeeId: committeeMembers.committeeId,
      memberId: committeeMembers.memberId,
      tenureEnd: committeeMembers.tenureEnd,
      version: committeeMembers.version,
      status: committeeMembers.status,
    })
    .from(committeeMembers)
    .where(
      and(
        eq(committeeMembers.status, "active"),
        isNotNull(committeeMembers.tenureEnd),
        lte(committeeMembers.tenureEnd, cutoffIso),
      ),
    ) as Promise<MembershipRow[]>;
}

/**
 * Default expiry: within the row's tenant scope, optimistic-locked UPDATE to
 * `expired` + `committee.member_expired` event + audit fact in one transaction,
 * then invalidate the committee read caches. Throws on version conflict so the
 * caller can count it as a failure and let the next run retry.
 */
async function defaultExpireMembership(row: MembershipRow, correlationId: string): Promise<void> {
  await runWithTenant(row.tenantId, async () => {
    await db.transaction(async (tx) => {
      await versionedUpdate(tx, committeeMembers, {
        id: row.id,
        tenantId: row.tenantId,
        expectedVersion: row.version,
        set: { status: "expired", updatedBy: SYSTEM_ACTOR_ID, updatedAt: new Date() },
        entity: "committee_member",
      });
      await enqueue(tx, {
        topic: EVENTS.committeeMemberExpired,
        eventType: EVENTS.committeeMemberExpired,
        tenantId: row.tenantId,
        actorId: SYSTEM_ACTOR_ID,
        correlationId,
        payload: {
          committeeId: row.committeeId,
          membershipId: row.id,
          memberId: row.memberId,
          expiredOn: row.tenureEnd,
        },
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: row.tenantId,
        actorId: SYSTEM_ACTOR_ID,
        correlationId,
        payload: {
          service: SERVICE,
          action: "member_expire",
          resourceType: "committee_member",
          resourceId: row.id,
          outcome: "success",
        },
      });
    });
  });
  await cache.invalidate(cache.makeKey(row.tenantId, CACHE_RESOURCE, row.committeeId));
  await cache.invalidateResource(row.tenantId, CACHE_RESOURCE);
}

/**
 * Default advance notice: within the row's tenant scope, emit
 * `committee.tenure_expiring` (+ audit) via the outbox. No status change — the
 * membership stays active until its tenure_end actually arrives.
 */
async function defaultNotifyExpiring(row: MembershipRow, correlationId: string): Promise<void> {
  await runWithTenant(row.tenantId, async () => {
    await db.transaction(async (tx) => {
      await enqueue(tx, {
        topic: EVENTS.committeeTenureExpiring,
        eventType: EVENTS.committeeTenureExpiring,
        tenantId: row.tenantId,
        actorId: SYSTEM_ACTOR_ID,
        correlationId,
        payload: {
          committeeId: row.committeeId,
          membershipId: row.id,
          memberId: row.memberId,
          tenureEnd: row.tenureEnd,
        },
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: row.tenantId,
        actorId: SYSTEM_ACTOR_ID,
        correlationId,
        payload: {
          service: SERVICE,
          action: "tenure_expiring_notice",
          resourceType: "committee_member",
          resourceId: row.id,
          outcome: "success",
        },
      });
    });
  });
}

// ─── Runnable worker ──────────────────────────────────────────────────────────

/**
 * Run one tenure-expiry cycle: scan → plan → apply. Emits advance-notice events for
 * memberships expiring within the window and transitions on/past-due memberships to
 * `expired`. Per-membership failures are isolated (logged + counted) so one bad row
 * never blocks the rest; the run always resolves with a summary. This is the runnable
 * unit worker.ts schedules.
 */
export async function runTenureExpiryWorker(deps: TenureExpiryDeps = {}): Promise<TenureExpiryResult> {
  const now = deps.now ?? new Date();
  const log = deps.logger ?? pino({ name: "meeting-tenure-expiry-worker" });
  const scan = deps.scan ?? defaultScan;
  const expireMembership = deps.expireMembership ?? defaultExpireMembership;
  const notifyExpiring = deps.notifyExpiring ?? defaultNotifyExpiring;
  const loadOverrides = deps.loadOverrides ?? defaultLoadOverrides;

  const today = toIsoDate(now);
  const correlationId = randomUUID();

  // An explicit deps.withinDays forces one flat window and skips config resolution entirely
  // (escape hatch — see the TenureExpiryDeps doc comment). Otherwise load the cross-tenant
  // override map once per cycle so a tenant-configured window (config-registry
  // committee.tenure_advance_notice_days) actually takes effect instead of silently being
  // ignored, which is the bug this wiring closes.
  const overrides =
    deps.withinDays === undefined ? await loadOverrides() : new Map<string, Map<string, unknown>>();

  // The SQL scan needs ONE cutoff up front, before it is known which tenants the rows belong
  // to, so it must be at least as wide as the LARGEST window any tenant has configured
  // (otherwise a tenant with a bigger-than-default window would have candidates silently
  // missed by the pre-filter). Per-tenant classification below then applies each row's own
  // tenant window, so a tenant with a smaller window is unaffected by a larger one elsewhere.
  const maxWithinDays =
    deps.withinDays ??
    Math.max(
      DEFAULT_ADVANCE_NOTICE_DAYS,
      ...[...overrides.keys()].map((tenantId) =>
        resolveNumber(overrides, tenantId, "committee.tenure_advance_notice_days"),
      ),
    );
  const cutoffIso = addDaysIso(today, maxWithinDays);

  const rows = await scan(cutoffIso);

  // Group by tenant and plan each group with that tenant's resolved window (defaults to 30
  // days when unconfigured — behavior-preserving for every tenant that has set nothing).
  const byTenant = new Map<string, MembershipRow[]>();
  for (const row of rows) {
    const list = byTenant.get(row.tenantId);
    if (list) list.push(row);
    else byTenant.set(row.tenantId, [row]);
  }
  const plan: TenurePlan = { expiries: [], expiringNotices: [] };
  for (const [tenantId, tenantRows] of byTenant) {
    const tenantWithinDays =
      deps.withinDays ?? resolveNumber(overrides, tenantId, "committee.tenure_advance_notice_days");
    const tenantPlan = planTenureActions(tenantRows, today, tenantWithinDays);
    plan.expiries.push(...tenantPlan.expiries);
    plan.expiringNotices.push(...tenantPlan.expiringNotices);
  }

  let expired = 0;
  let expiring = 0;
  let failed = 0;

  for (const row of plan.expiries) {
    try {
      await expireMembership(row, correlationId);
      expired += 1;
    } catch (err) {
      failed += 1;
      log.error(
        { membershipId: row.id, committeeId: row.committeeId, tenantId: row.tenantId, err: err instanceof Error ? err.stack : String(err) },
        "tenure-expiry: failed to expire membership",
      );
    }
  }

  for (const row of plan.expiringNotices) {
    try {
      await notifyExpiring(row, correlationId);
      expiring += 1;
    } catch (err) {
      failed += 1;
      log.error(
        { membershipId: row.id, committeeId: row.committeeId, tenantId: row.tenantId, err: err instanceof Error ? err.stack : String(err) },
        "tenure-expiry: failed to emit tenure_expiring notice",
      );
    }
  }

  const result: TenureExpiryResult = { scanned: rows.length, expired, expiring, failed };
  log.info({ ...result, correlationId, today, maxWithinDays }, "tenure-expiry: cycle complete");
  return result;
}

/**
 * Start the daily tenure-expiry scheduler. Runs `runTenureExpiryWorker` every
 * `intervalMs` (default 24h) and never rethrows — a failing cycle is logged and the
 * loop continues (mirrors `startOutboxPurge`/`startRelay`). Returns the interval
 * handle so worker.ts can `clearInterval` it on graceful shutdown.
 */
export function startTenureExpiryScheduler(
  intervalMs: number = DEFAULT_INTERVAL_MS,
  deps: TenureExpiryDeps = {},
): NodeJS.Timeout {
  const log = deps.logger ?? pino({ name: "meeting-tenure-expiry-worker" });
  const tick = (): void => {
    void runTenureExpiryWorker(deps).catch((err) => {
      log.error({ err: err instanceof Error ? err.stack : String(err) }, "tenure-expiry: scheduler cycle failed");
    });
  };
  const handle = setInterval(tick, intervalMs);
  // Do not keep the event loop alive solely for this timer.
  if (typeof handle.unref === "function") handle.unref();
  return handle;
}
