import { eq, and, lte, sql, desc } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, scopedRead} from "../../shared/db.js";
import { scannerDb } from "../../shared/scanner-db.js";
import { enqueue } from "../../shared/outbox.js";
import { grants, type GrantRow, type GrantInsert } from "./schema.js";
import type { GrantView, GrantStatus } from "./domain.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export function toView(r: GrantRow): GrantView {
  return {
    id: r.id, tenantId: r.tenantId, userId: r.userId, reason: r.reason, scope: r.scope,
    status: r.status as GrantStatus, grantedBy: r.grantedBy,
    closedBy: r.closedBy ?? null, closeReason: r.closeReason ?? null,
    grantedAt: r.grantedAt.toISOString(), expiresAt: r.expiresAt.toISOString(),
    closedAt: r.closedAt ? r.closedAt.toISOString() : null, version: r.version,
  };
}

export async function findById(tx: Writer, tenantId: string, id: string): Promise<GrantRow | null> {
  const rows = await tx.select().from(grants)
    .where(and(eq(grants.id, id), eq(grants.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findByIdForUpdate(tx: Writer, tenantId: string, id: string): Promise<GrantRow | null> {
  const rows = await tx.select().from(grants)
    .where(and(eq(grants.id, id), eq(grants.tenantId, tenantId)))
    .limit(1).for("update");
  return rows[0] ?? null;
}

export async function findActiveForUser(tx: Writer, tenantId: string, userId: string): Promise<GrantRow | null> {
  const rows = await tx.select().from(grants)
    .where(and(eq(grants.tenantId, tenantId), eq(grants.userId, userId), eq(grants.status, "active")))
    .limit(1);
  return rows[0] ?? null;
}

export async function insert(tx: Writer, row: GrantInsert): Promise<void> {
  await tx.insert(grants).values(row);
}

export async function setStatus(
  tx: Writer, tenantId: string, id: string, expectedVersion: number,
  patch: Partial<GrantInsert>,
): Promise<number> {
  const res = await tx.update(grants)
    .set({ ...patch, updatedAt: new Date(), version: expectedVersion + 1 })
    .where(and(eq(grants.id, id), eq(grants.tenantId, tenantId), eq(grants.version, expectedVersion)))
    .returning({ id: grants.id });
  return res.length;
}

export async function listByTenant(tenantId: string, status: string | undefined, limit: number, offset: number): Promise<GrantView[]> {
  const where = status
    ? and(eq(grants.tenantId, tenantId), eq(grants.status, status))
    : eq(grants.tenantId, tenantId);
  const rows = await scopedRead((tx) => tx.select().from(grants)
    .where(where).orderBy(desc(grants.grantedAt)).limit(limit).offset(offset));
  return rows.map(toView);
}

/**
 * TTL sweep: flip any still-"active" grant past its expiry to "expired".
 * Tenant-agnostic housekeeping run by the worker. Returns the count swept.
 *
 * RLS fix: identity_svc (the primary `db` connection) is NOBYPASSRLS and
 * breakglass.grants is FORCE ROW LEVEL SECURITY. worker.ts invokes this from
 * a bare setInterval with no app.tenant_id GUC set (it is NOT wrapped in
 * runWithTenant — only per-message queue consumers get that), so
 * `tenant_id = current_tenant_id()` compared against NULL matched zero rows,
 * for every tenant, every time. Discover candidates via the identity_scanner
 * BYPASSRLS role (read-only, migration 0020), then perform the actual write
 * per-tenant on the primary connection inside runWithTenant(tenantId, ...) so
 * RLS still governs the mutation. Mirrors helpdesk-service's
 * tickets/sweeper.ts pattern and sessions/repo.ts#reapExpiredSessions above.
 */
export async function sweepExpiredGrants(batch = 500): Promise<number> {
  const candidates = await scannerDb.select({ id: grants.id, tenantId: grants.tenantId })
    .from(grants)
    .where(and(eq(grants.status, "active"), lte(grants.expiresAt, sql`now()`)))
    .limit(batch);

  const byTenant = new Map<string, string[]>();
  for (const c of candidates) {
    const ids = byTenant.get(c.tenantId) ?? [];
    ids.push(c.id);
    byTenant.set(c.tenantId, ids);
  }

  let expired = 0;
  for (const [tenantId] of byTenant) {
    expired += await runWithTenant(tenantId, async () => db.transaction(async (tx) => {
      const rows = await tx.update(grants)
        .set({ status: "expired", updatedAt: new Date() })
        .where(and(
          eq(grants.tenantId, tenantId),
          eq(grants.status, "active"),
          lte(grants.expiresAt, sql`now()`),
        ))
        .returning({ id: grants.id });
      return rows.length;
    }));
  }
  return expired;
}

export async function emitAudit(
  tx: unknown, e: { eventType: string; tenantId: string; actorId: string; correlationId: string; payload: Record<string, unknown>; action: string; resourceId: string; severity?: string },
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, { topic: e.eventType, eventType: e.eventType, tenantId: e.tenantId, actorId: e.actorId, correlationId: e.correlationId, payload: e.payload });
  await enqueue(t, {
    topic: "audit.event.record", eventType: "audit.event.record",
    tenantId: e.tenantId, actorId: e.actorId, correlationId: e.correlationId,
    payload: { service: "identity", action: e.action, resourceType: "break_glass_grant", resourceId: e.resourceId, outcome: "success", severity: e.severity ?? "critical" },
  });
}
