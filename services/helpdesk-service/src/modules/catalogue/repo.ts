/**
 * Service Catalogue (SVC-129) — repository (data access).
 *
 * Reads wrap in db.transaction() so createTenantDb's wrapWithTenantGuc injects
 * app.tenant_id from AsyncLocalStorage before the query — a bare db.select()
 * runs with no RLS GUC set and returns zero rows under fail-closed policies.
 * Writers accept a tx so callers compose them into a single atomic transaction
 * alongside outbox enqueues.
 */
import { and, desc, eq, inArray, isNull, lte, notInArray, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import {
  catalogueOfferings,
  catalogueOlas,
  serviceRequests,
  requestApprovals,
  requestStageEvents,
  type OfferingRow,
  type OfferingInsert,
  type OlaRow,
  type OlaInsert,
  type ServiceRequestRow,
  type ServiceRequestInsert,
  type RequestApprovalRow,
  type RequestStageEventRow,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select" | "delete">;

// ── Offerings ─────────────────────────────────────────────────────────────────

export async function insertOffering(tx: Writer, row: OfferingInsert): Promise<OfferingRow> {
  const res = await (tx as typeof db).insert(catalogueOfferings).values(row).returning();
  return res[0]!;
}

export async function listOfferings(
  tenantId: string,
  opts: { status?: string | undefined; category?: string | undefined; limit: number; offset: number },
): Promise<OfferingRow[]> {
  return db.transaction((tx) => {
    const conds = [eq(catalogueOfferings.tenantId, tenantId)];
    if (opts.status) conds.push(eq(catalogueOfferings.status, opts.status));
    if (opts.category) conds.push(eq(catalogueOfferings.category, opts.category));
    return tx
      .select()
      .from(catalogueOfferings)
      .where(and(...conds))
      .orderBy(desc(catalogueOfferings.createdAt))
      .limit(opts.limit)
      .offset(opts.offset);
  });
}

export async function findOffering(id: string, tenantId: string): Promise<OfferingRow | null> {
  const rows = await db.transaction((tx) =>
    tx
      .select()
      .from(catalogueOfferings)
      .where(and(eq(catalogueOfferings.id, id), eq(catalogueOfferings.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function updateOffering(
  tx: Writer,
  id: string,
  tenantId: string,
  patch: Partial<OfferingInsert>,
): Promise<OfferingRow | null> {
  const res = await (tx as typeof db)
    .update(catalogueOfferings)
    .set({ ...patch, updatedAt: new Date(), version: sql`${catalogueOfferings.version} + 1` })
    .where(and(eq(catalogueOfferings.id, id), eq(catalogueOfferings.tenantId, tenantId)))
    .returning();
  return res[0] ?? null;
}

// ── OLAs ────────────────────────────────────────────────────────────────────

export async function insertOla(tx: Writer, row: OlaInsert): Promise<OlaRow> {
  const res = await (tx as typeof db).insert(catalogueOlas).values(row).returning();
  return res[0]!;
}

export async function listOlas(tenantId: string, offeringId: string): Promise<OlaRow[]> {
  return db.transaction((tx) =>
    tx
      .select()
      .from(catalogueOlas)
      .where(and(eq(catalogueOlas.tenantId, tenantId), eq(catalogueOlas.offeringId, offeringId)))
      .orderBy(catalogueOlas.targetMinutes),
  );
}

// ── Service requests ──────────────────────────────────────────────────────────

export async function insertRequest(tx: Writer, row: ServiceRequestInsert): Promise<ServiceRequestRow> {
  const res = await (tx as typeof db).insert(serviceRequests).values(row).returning();
  return res[0]!;
}

export async function findRequest(id: string, tenantId: string): Promise<ServiceRequestRow | null> {
  const rows = await db.transaction((tx) =>
    tx
      .select()
      .from(serviceRequests)
      .where(and(eq(serviceRequests.id, id), eq(serviceRequests.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function updateRequest(
  tx: Writer,
  id: string,
  tenantId: string,
  patch: Partial<ServiceRequestInsert>,
): Promise<ServiceRequestRow | null> {
  const res = await (tx as typeof db)
    .update(serviceRequests)
    .set({ ...patch, updatedAt: new Date(), version: sql`${serviceRequests.version} + 1` })
    .where(and(eq(serviceRequests.id, id), eq(serviceRequests.tenantId, tenantId)))
    .returning();
  return res[0] ?? null;
}

export async function listRequests(
  tenantId: string,
  opts: { requestedBy?: string | undefined; status?: string | undefined; limit: number; offset: number },
): Promise<ServiceRequestRow[]> {
  return db.transaction((tx) => {
    const conds = [eq(serviceRequests.tenantId, tenantId)];
    if (opts.requestedBy) conds.push(eq(serviceRequests.requestedBy, opts.requestedBy));
    if (opts.status) conds.push(eq(serviceRequests.status, opts.status));
    return tx
      .select()
      .from(serviceRequests)
      .where(and(...conds))
      .orderBy(desc(serviceRequests.createdAt))
      .limit(opts.limit)
      .offset(opts.offset);
  });
}

/** Breach report: requests currently past resolution or already breach-marked. */
export async function listBreachedRequests(tenantId: string, limit = 200): Promise<ServiceRequestRow[]> {
  return db.transaction((tx) =>
    tx
      .select()
      .from(serviceRequests)
      .where(
        and(
          eq(serviceRequests.tenantId, tenantId),
          inArray(serviceRequests.slaStatus, ["breached", "at_risk"]),
        ),
      )
      .orderBy(serviceRequests.resolutionDeadline)
      .limit(limit),
  );
}

// ── Approvals + stage events ──────────────────────────────────────────────────

export async function insertApproval(
  tx: Writer,
  row: typeof requestApprovals.$inferInsert,
): Promise<RequestApprovalRow> {
  const res = await (tx as typeof db).insert(requestApprovals).values(row).returning();
  return res[0]!;
}

export async function listApprovals(tenantId: string, requestId: string): Promise<RequestApprovalRow[]> {
  return db.transaction((tx) =>
    tx
      .select()
      .from(requestApprovals)
      .where(and(eq(requestApprovals.tenantId, tenantId), eq(requestApprovals.requestId, requestId)))
      .orderBy(requestApprovals.decidedAt),
  );
}

export async function insertStageEvent(
  tx: Writer,
  row: typeof requestStageEvents.$inferInsert,
): Promise<RequestStageEventRow> {
  const res = await (tx as typeof db).insert(requestStageEvents).values(row).returning();
  return res[0]!;
}

export async function listStageEvents(tenantId: string, requestId: string): Promise<RequestStageEventRow[]> {
  return db.transaction((tx) =>
    tx
      .select()
      .from(requestStageEvents)
      .where(and(eq(requestStageEvents.tenantId, tenantId), eq(requestStageEvents.requestId, requestId)))
      .orderBy(requestStageEvents.at),
  );
}

// ── SLA-breach sweeper support ────────────────────────────────────────────────

/**
 * Candidate requests for the breach sweeper: still open (not terminal), with a
 * resolution deadline that has passed as of `now`, and not yet escalated.
 *
 * INTENTIONAL cross-tenant scan (bare scopedRead / no per-tenant GUC): the
 * sweeper polls all tenants in one query then groups by tenantId — same class of
 * platform-scoped sweeper as tickets/repo.ts findOpenForSla(). Per-tenant writes
 * derived from these candidates ARE tenant-scoped (see ./sweeper.ts, which wraps
 * each tenant's batch in runWithTenant()).
 */
export async function findOverdueOpenRequests(now: Date, batch = 200): Promise<ServiceRequestRow[]> {
  return scopedRead((tx) =>
    tx
      .select()
      .from(serviceRequests)
      .where(
        and(
          notInArray(serviceRequests.status, ["fulfilled", "rejected", "cancelled"]),
          isNull(serviceRequests.breachEscalatedAt),
          lte(serviceRequests.resolutionDeadline, now),
        ),
      )
      .limit(batch),
  );
}

/**
 * Stamp the breach-escalation marker only if still unset — a CAS so overlapping
 * sweeps (and restarts) escalate exactly once. Returns true if THIS call claimed
 * the stamp (caller should then emit escalation/notify/audit).
 */
export async function markBreachEscalated(
  tx: Writer,
  id: string,
  tenantId: string,
  now: Date,
): Promise<boolean> {
  const res = await (tx as typeof db)
    .update(serviceRequests)
    .set({ breachEscalatedAt: now, slaStatus: "breached", updatedAt: now })
    .where(
      and(
        eq(serviceRequests.id, id),
        eq(serviceRequests.tenantId, tenantId),
        isNull(serviceRequests.breachEscalatedAt),
      ),
    )
    .returning({ id: serviceRequests.id });
  return res.length > 0;
}
