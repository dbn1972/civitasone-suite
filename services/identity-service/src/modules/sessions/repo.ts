import { eq, and, lte, sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, scopedRead} from "../../shared/db.js";
import { scannerDb } from "../../shared/scanner-db.js";
import { sessions, type SessionRow, type SessionInsert } from "./schema.js";
import type { SessionView } from "./domain.js";

function toView(r: SessionRow): SessionView {
  // P1-2: an "active" row whose expiry has passed is presented as "expired"
  // even before the reaper sweep flips it, so reads never surface a stale
  // active session.
  const rawStatus = r.status as SessionView["status"];
  const status: SessionView["status"] =
    rawStatus === "active" && r.expiresAt.getTime() <= Date.now() ? "expired" : rawStatus;
  return {
    id: r.id, tenantId: r.tenantId, userId: r.userId, ip: r.ip,
    device: r.device ?? null, mfaMethod: r.mfaMethod ?? null, trusted: r.trusted,
    status,
    userEmail: r.userEmail,
    userName: r.userName ?? null,
    userAgent: r.userAgent ?? null,
    lastActiveAt: r.lastActiveAt.toISOString(),
    startedAt: r.startedAt.toISOString(), expiresAt: r.expiresAt.toISOString(),
    version: r.version,
  };
}

export async function findById(tenantId: string, id: string): Promise<SessionView | null> {
  const rows = await scopedRead((tx) => tx.select().from(sessions)
    .where(and(eq(sessions.id, id), eq(sessions.tenantId, tenantId)))
    .limit(1));
  return rows[0] ? toView(rows[0]) : null;
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: SessionInsert): Promise<void> {
  await tx.insert(sessions).values(row);
}

export async function update(tx: Writer, tenantId: string, id: string, patch: Partial<SessionInsert>): Promise<void> {
  await tx.update(sessions).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(sessions.id, id), eq(sessions.tenantId, tenantId)));
}

export async function findByIdTx(tx: Writer, tenantId: string, id: string): Promise<SessionView | null> {
  const rows = await tx.select().from(sessions)
    .where(and(eq(sessions.id, id), eq(sessions.tenantId, tenantId)))
    .limit(1);
  return rows[0] ? toView(rows[0]) : null;
}

export async function listByTenant(tenantId: string, limit: number): Promise<SessionView[]> {
  const rows = await scopedRead((tx) => tx.select().from(sessions)
    .where(eq(sessions.tenantId, tenantId))
    .limit(limit)
    .orderBy(sessions.startedAt));
  return rows.map(toView);
}

// Revoke-all (P0 security): flip every still-"active" session for one user
// (tenant-scoped) to "revoked" in a single statement. Runs inside the caller's
// transaction so the audit emit and the mutation commit atomically. Returns the
// ids that transitioned — already-revoked/expired rows are left untouched, which
// makes a repeat call a no-op (idempotent).
export async function revokeAllForUser(tx: Writer, tenantId: string, userId: string, actorId: string): Promise<string[]> {
  const rows = await tx.update(sessions)
    .set({ status: "revoked", updatedBy: actorId, updatedAt: new Date() })
    .where(and(eq(sessions.tenantId, tenantId), eq(sessions.userId, userId), eq(sessions.status, "active")))
    .returning({ id: sessions.id });
  return rows.map((r) => r.id);
}


// P1-2: expired-session reaper. Flip any still-"active" row whose expiry has
// passed to "expired". Tenant-agnostic by design (a global housekeeping sweep
// run by the worker). Returns the number of rows transitioned.
//
// RLS fix: identity_svc (the primary `db` connection) is NOBYPASSRLS and
// sessions.sessions is FORCE ROW LEVEL SECURITY, so a bare cross-tenant
// db.update() with no app.tenant_id GUC set — which is exactly how worker.ts's
// setInterval invoked this — matched zero rows for every tenant, forever.
// Discover candidates via the identity_scanner BYPASSRLS role (read-only,
// migration 0020), then perform the actual write per-tenant on the primary
// connection inside runWithTenant(tenantId, ...) so RLS still governs the
// mutation. Mirrors helpdesk-service's tickets/sweeper.ts pattern.
export async function reapExpiredSessions(batch = 500): Promise<number> {
  const candidates = await scannerDb.select({ id: sessions.id, tenantId: sessions.tenantId })
    .from(sessions)
    .where(and(eq(sessions.status, "active"), lte(sessions.expiresAt, sql`now()`)))
    .limit(batch);

  const byTenant = new Map<string, string[]>();
  for (const c of candidates) {
    const ids = byTenant.get(c.tenantId) ?? [];
    ids.push(c.id);
    byTenant.set(c.tenantId, ids);
  }

  let reaped = 0;
  for (const [tenantId, ids] of byTenant) {
    // Must go through db.transaction(): wrapWithTenantGuc only intercepts
    // transaction(), not a bare db.update() — the exact same class of bug this
    // function exists to fix, reproduced one level down. A bare db.update()
    // here would silently affect zero rows again, just via a different code
    // path (no GUC set, so the WITH CHECK / USING clause never matches).
    reaped += await runWithTenant(tenantId, () => db.transaction(async (tx) => {
      const rows = await tx.update(sessions)
        .set({ status: "expired", updatedAt: new Date() })
        .where(and(
          eq(sessions.tenantId, tenantId),
          eq(sessions.status, "active"),
          lte(sessions.expiresAt, sql`now()`),
        ))
        .returning({ id: sessions.id });
      return rows.length;
    }));
  }
  return reaped;
}
