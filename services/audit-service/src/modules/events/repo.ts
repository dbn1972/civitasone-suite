import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
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

export async function listEvents(tenantId: string, from: Date, to: Date, type?: string, limit = 50, offset = 0): Promise<AuditEventView[]> {
  const conditions = [
    eq(auditEvents.tenantId, tenantId),
    gte(auditEvents.occurredAt, from),
    lte(auditEvents.occurredAt, to),
  ];
  if (type) conditions.push(eq(auditEvents.type, type));
  const rows = await runWithTenant(tenantId, () => db.transaction((tx) => tx.select().from(auditEvents)
    .where(and(...conditions))
    .orderBy(desc(auditEvents.occurredAt))
    .limit(limit).offset(offset)));
  return rows.map(toView);
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
    const latest = await findLatestForTenant(tenantId);
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
