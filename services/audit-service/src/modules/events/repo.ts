import { eq, and, gte, lte, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { auditEvents, type AuditEventRow, type AuditEventInsert } from "./schema.js";
import type { AuditEventView } from "./domain.js";

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

export async function findById(id: string): Promise<AuditEventView | null> {
  const rows = await db.select().from(auditEvents).where(eq(auditEvents.id, id)).limit(1);
  return rows[0] ? toView(rows[0]) : null;
}

export async function findLatestForTenant(tenantId: string): Promise<AuditEventView | null> {
  const rows = await db.select().from(auditEvents)
    .where(eq(auditEvents.tenantId, tenantId))
    .orderBy(desc(auditEvents.occurredAt))
    .limit(1);
  return rows[0] ? toView(rows[0]) : null;
}

export async function listEvents(tenantId: string, from: Date, to: Date, type?: string, limit = 50, offset = 0): Promise<AuditEventView[]> {
  const conditions = [
    eq(auditEvents.tenantId, tenantId),
    gte(auditEvents.occurredAt, from),
    lte(auditEvents.occurredAt, to),
  ];
  if (type) conditions.push(eq(auditEvents.type, type));
  const rows = await db.select().from(auditEvents)
    .where(and(...conditions))
    .orderBy(desc(auditEvents.occurredAt))
    .limit(limit).offset(offset);
  return rows.map(toView);
}

export type Writer = Pick<typeof db, "insert" | "select">;

export async function insert(tx: Writer, row: AuditEventInsert): Promise<void> {
  await tx.insert(auditEvents).values(row);
}
