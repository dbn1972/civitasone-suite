import { eq, and, gte, lte, desc, sql, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { auditEvents, type AuditEventRow, type AuditEventInsert } from "./schema.js";
import type { AuditEventView } from "./domain.js";
import { computeHash } from "./domain.js";

function toView(r: AuditEventRow): AuditEventView {
  return {
    id: r.id, tenantId: r.tenantId, type: r.type, actor: r.actor,
    target: r.target ?? null, payload: r.payload, severity: r.severity,
    // CERT-In §4 fields (columns added by migration 0004; computed from payload when not in DB row)
    ipAddress: r.ipAddress ?? null,
    userAgent: r.userAgent ?? null,
    oldValue: r.oldValue ?? null,
    newValue: r.newValue ?? null,
    prevHash: r.prevHash ?? null, eventHash: r.eventHash ?? null,
    correlationId: r.correlationId ?? null,
    occurredAt: r.occurredAt.toISOString(),
    // Compute 180-day retention deadline; retain_until DB column added by migration 0004
    retainUntil: (r.retainUntil ?? new Date(r.occurredAt.getTime() + 180 * 86400 * 1000)).toISOString(),
  };
}

/**
 * G-FIX-3: every function below takes `tenantId` as an explicit parameter but
 * previously ran its query inside a bare `db.transaction()`, which sets the
 * RLS `app.tenant_id` GUC from the AMBIENT AsyncLocalStorage context (see
 * @civitasone/db's wrapWithTenantGuc) — populated once per request from the
 * CALLER's own JWT tenant, not from whatever `tenantId` a caller passes in
 * here. For every normal (same-tenant) call the two happen to match, so this
 * was invisible. For the one caller that legitimately passes a DIFFERENT
 * tenantId — events/routes.ts's admin cross-tenant audit-trail read — RLS
 * silently filtered out every row of the target tenant's data, because the
 * GUC stayed pinned to the admin's own tenant regardless of what this
 * function's WHERE clause asked for. Confirmed live: an admin querying a
 * tenant with 1,690 real rows got back [].
 *
 * Wrapping each query in runWithTenant(tenantId, ...) makes the GUC always
 * match the tenantId this function was actually asked to read, regardless of
 * the ambient per-request context — correct for the common case (where they
 * already matched) and now also correct for a legitimate cross-tenant
 * caller, with no per-call-site opt-in required.
 */
export async function findById(id: string, tenantId: string): Promise<AuditEventView | null> {
  const rows = await runWithTenant(tenantId, () => db.transaction((tx) => tx.select().from(auditEvents).where(and(eq(auditEvents.id, id), eq(auditEvents.tenantId, tenantId))).limit(1)));
  return rows[0] ? toView(rows[0]) : null;
}

export async function findLatestForTenant(tenantId: string): Promise<AuditEventView | null> {
  const rows = await runWithTenant(tenantId, () => db.transaction((tx) => tx.select().from(auditEvents)
    .where(eq(auditEvents.tenantId, tenantId))
    .orderBy(desc(auditEvents.occurredAt))
    .limit(1)));
  return rows[0] ? toView(rows[0]) : null;
}

/**
 * TX-001: sibling of findLatestForTenant() that reads through an
 * already-open transaction (`tx`) instead of opening its own via
 * db.transaction(). Call this -- never the bare findLatestForTenant() --
 * from inside an outer db.transaction() block (events/consumer.ts's
 * per-message handler; this file's own writeEvent()). The bare call nests a
 * second db.transaction() inside the first, each needing its own pool
 * connection; under concurrent load (N in-flight outer transactions using
 * up to pool.max connections, each then blocking on a second connection for
 * the nested read that will never free) this deadlocks the whole pool.
 * Safe to skip the runWithTenant()/GUC dance findLatestForTenant() does for
 * its own db.transaction(): both call sites pass the SAME tenantId that is
 * already the outer transaction's ambient tenant, so app.tenant_id is
 * already correct on `tx`.
 */
export async function findLatestForTenantTx(tx: Writer, tenantId: string): Promise<AuditEventView | null> {
  const rows = await (tx as typeof db).select().from(auditEvents)
    .where(eq(auditEvents.tenantId, tenantId))
    .orderBy(desc(auditEvents.occurredAt))
    .limit(1);
  return rows[0] ? toView(rows[0]) : null;
}

/**
 * Optional narrowing filters for listEvents (GAP-HR-AUDIT-LOG-07/08). All
 * three match fields the producers already write: `payload.service` and
 * `payload.resourceType` (every hrms/payroll consumer's audit payload carries
 * both) and the `actor` jsonb ({actorId, email?, name?}).
 */
export interface ListEventsFilters {
  /** payload->>'service' IN (...) -- e.g. ["hrms", "payroll"] for the HR audit log. */
  services?: string[];
  /** payload->>'resourceType' = ... */
  resourceType?: string;
  /** Exact actorId, or a case-insensitive substring of the actor's email/name. */
  actor?: string;
}

/** Escapes LIKE wildcards so user input is matched literally. */
function escapeLike(v: string): string {
  return v.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** WHERE conditions shared by listEvents / countEvents / listEventsForExport so all three always agree on what "matching" means. */
function eventConditions(tenantId: string, from: Date, to: Date, type: string | undefined, filters: ListEventsFilters) {
  const conditions = [
    eq(auditEvents.tenantId, tenantId),
    gte(auditEvents.occurredAt, from),
    lte(auditEvents.occurredAt, to),
  ];
  if (type) conditions.push(eq(auditEvents.type, type));
  if (filters.services && filters.services.length > 0) {
    conditions.push(inArray(sql<string>`${auditEvents.payload}->>'service'`, filters.services));
  }
  if (filters.resourceType) {
    conditions.push(sql`${auditEvents.payload}->>'resourceType' = ${filters.resourceType}`);
  }
  if (filters.actor) {
    const like = `%${escapeLike(filters.actor)}%`;
    conditions.push(sql`(${auditEvents.actor}->>'actorId' = ${filters.actor} OR ${auditEvents.actor}->>'email' ILIKE ${like} OR ${auditEvents.actor}->>'name' ILIKE ${like})`);
  }
  return conditions;
}

export async function listEvents(tenantId: string, from: Date, to: Date, type?: string, limit = 50, offset = 0, filters: ListEventsFilters = {}): Promise<AuditEventView[]> {
  const conditions = eventConditions(tenantId, from, to, type, filters);
  const rows = await runWithTenant(tenantId, () => db.transaction((tx) => tx.select().from(auditEvents)
    .where(and(...conditions))
    .orderBy(desc(auditEvents.occurredAt))
    .limit(limit).offset(offset)));
  return rows.map(toView);
}

/**
 * GAP-HR-AUDIT-LOG-04: the number of events matching exactly the filters
 * listEvents applies, so a paged view can say "Showing 41-60 of N" with N
 * being the real tenant-scoped row count rather than the size of one page.
 */
export async function countEvents(tenantId: string, from: Date, to: Date, type?: string, filters: ListEventsFilters = {}): Promise<number> {
  const conditions = eventConditions(tenantId, from, to, type, filters);
  const rows = await runWithTenant(tenantId, () => db.transaction((tx) => tx.select({ total: sql<number>`count(*)::int` })
    .from(auditEvents)
    .where(and(...conditions))));
  return Number(rows[0]?.total ?? 0);
}

/** The narrow projection a CSV export needs -- never the whole payload / CERT-In columns. */
export type ExportEventRow = {
  id: string;
  type: string;
  actor: Record<string, unknown>;
  target: string | null;
  severity: string;
  occurredAt: Date;
  service: string | null;
  action: string | null;
  resourceType: string | null;
  resourceId: string | null;
  outcome: string | null;
};

/**
 * GAP-HR-AUDIT-LOG-04: every event matching the filters (same conditions as
 * listEvents), newest first with a stable (occurred_at, id) order, in ONE
 * query -- so there is no offset drift against a table that keeps growing.
 * Capped at `max + 1` rows: the caller refuses to export when more than `max`
 * come back instead of silently truncating an audit trail.
 */
export async function listEventsForExport(tenantId: string, from: Date, to: Date, type: string | undefined, filters: ListEventsFilters, max: number): Promise<ExportEventRow[]> {
  const conditions = eventConditions(tenantId, from, to, type, filters);
  return runWithTenant(tenantId, () => db.transaction((tx) => tx.select({
    id: auditEvents.id,
    type: auditEvents.type,
    actor: auditEvents.actor,
    target: auditEvents.target,
    severity: auditEvents.severity,
    occurredAt: auditEvents.occurredAt,
    service: sql<string | null>`${auditEvents.payload}->>'service'`,
    action: sql<string | null>`${auditEvents.payload}->>'action'`,
    resourceType: sql<string | null>`${auditEvents.payload}->>'resourceType'`,
    resourceId: sql<string | null>`${auditEvents.payload}->>'resourceId'`,
    outcome: sql<string | null>`${auditEvents.payload}->>'outcome'`,
  }).from(auditEvents)
    .where(and(...conditions))
    .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
    .limit(max + 1)));
}

export type AuditEventSummary = { total: number; failures: number; success: number; last24h: number; asOf: string };

/**
 * GAP-TENANT-ADMIN-AUDIT-04/-06: server-side counts for the whole tenant history,
 * so the audit KPIs are not just the size of whichever page the list endpoint
 * returned. "failure" mirrors the list route's outcome rule (severity error or
 * critical); everything else is "success".
 */
export async function summarizeEvents(tenantId: string): Promise<AuditEventSummary> {
  const rows = await runWithTenant(tenantId, () => db.transaction((tx) => tx.select({
    total: sql<number>`count(*)::int`,
    failures: sql<number>`(count(*) filter (where ${auditEvents.severity} in ('error', 'critical')))::int`,
    last24h: sql<number>`(count(*) filter (where ${auditEvents.occurredAt} >= now() - interval '24 hours'))::int`,
  }).from(auditEvents).where(eq(auditEvents.tenantId, tenantId))));
  const r = rows[0] ?? { total: 0, failures: 0, last24h: 0 };
  const total = Number(r.total), failures = Number(r.failures);
  return { total, failures, success: total - failures, last24h: Number(r.last24h), asOf: new Date().toISOString() };
}

/** Return audit trail for a specific entity (identified by resourceType + resourceId). */
export async function listEventsByEntity(
  tenantId: string,
  resourceType: string,
  resourceId: string,
  limit = 50,
  offset = 0,
): Promise<AuditEventView[]> {
  const rows = await runWithTenant(tenantId, () => db.transaction((tx) =>
    tx.select().from(auditEvents)
      .where(and(
        eq(auditEvents.tenantId, tenantId),
        eq(auditEvents.target, resourceId),
        sql`${auditEvents.payload}->>'resourceType' = ${resourceType}`,
      ))
      .orderBy(desc(auditEvents.occurredAt))
      .limit(limit)
      .offset(offset),
  ));
  return rows.map(toView);
}

/**
 * Directly write an audit event inside a transaction (API path — queue is preferred for
 * cross-service events). Maintains the tamper-evident chain hash, mirrors the consumer logic.
 */
export async function writeEvent(
  tenantId: string,
  actorId: string,
  type: string,
  resourceType: string,
  resourceId: string,
  severity: string,
  payload: Record<string, unknown>,
  correlationId: string,
  ipAddress?: string | null,
  userAgent?: string | null,
): Promise<string> {
  return db.transaction(async (tx) => {
    // Serialize per-tenant chain appends (mirrors consumer).
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${tenantId}))`);
    const latest = await findLatestForTenantTx(tx, tenantId);
    const id = randomUUID();
    const now = new Date().toISOString();
    const retainUntil = new Date(Date.now() + 180 * 86400 * 1000);
    const actor: Record<string, unknown> = { actorId, ...((payload.actor as Record<string, unknown>) ?? {}) };
    const target = resourceId;
    const enrichedPayload: Record<string, unknown> = {
      ...payload,
      resourceType,
      resourceId,
      _certIn: {
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ?? null,
        oldValue: (payload.oldValue as Record<string, unknown>) ?? null,
        newValue: (payload.newValue as Record<string, unknown>) ?? null,
        retainUntil: retainUntil.toISOString(),
      },
    };
    const eventHash = computeHash(id, tenantId, type, latest?.eventHash ?? null, now, {
      actor, target, payload: enrichedPayload,
    });
    await tx.insert(auditEvents).values({
      id, tenantId, type,
      actor,
      target,
      payload: enrichedPayload,
      severity,
      prevHash: latest?.eventHash ?? null,
      eventHash,
      correlationId,
      createdBy: actorId,
      ipAddress: ipAddress ?? null,
      userAgent: userAgent ?? null,
      oldValue: (payload.oldValue as Record<string, unknown>) ?? null,
      newValue: (payload.newValue as Record<string, unknown>) ?? null,
      retainUntil,
    });
    return id;
  });
}

export type Writer = Pick<typeof db, "insert" | "select">;

export async function insert(tx: Writer, row: AuditEventInsert): Promise<void> {
  await tx.insert(auditEvents).values(row);
}
