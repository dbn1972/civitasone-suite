import { eq, and, desc, notInArray, isNull, or, sql, asc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { scannerDb } from "../../shared/scanner-db.js";
import { tickets, type TicketRow, type TicketInsert, type TicketView } from "./schema.js";
import { slaPolicies } from "../sla/schema.js";
import { evaluateSlaStatus, resolvePolicy, DEFAULT_SLA_POLICIES, type SlaPolicy, type SlaEvalStatus } from "../sla/domain.js";
import { ticketNotes, type TicketNoteInsert, type TicketNoteRow } from "./notes-schema.js";
import { ticketLinks, type TicketLinkInsert, type TicketLinkRow } from "./links-schema.js";
import { ticketTransfers, type TicketTransferInsert, type TicketTransferRow } from "./transfer-schema.js";

function mapStatus(status: string): TicketView["status"] {
  const s = status.toLowerCase();
  if (s === "closed") return "Closed";
  if (s === "resolved") return "Resolved";
  if (s === "in_progress" || s === "assigned") return "In Progress";
  return "Open";
}

function mapPriority(priority: string): TicketView["priority"] {
  const p = priority.toLowerCase();
  if (p === "low") return "Low";
  if (p === "high") return "High";
  if (p === "critical") return "Critical";
  return "Medium";
}

export type SlaStatus = SlaEvalStatus;

/** SLA window: 3 business-equivalent days for High/Critical, 5 otherwise (legacy fallback). */
export function slaDays(priority: string | null | undefined): number {
  const p = priority?.toLowerCase() ?? "medium";
  return (p === "high" || p === "critical") ? 3 : 5;
}

/**
 * Compute SLA due date + breach status for a ticket row at a given instant.
 * Uses policy-based computation when policies are provided, otherwise falls back
 * to the legacy day-based computation.
 */
export function computeSla(
  r: TicketRow,
  now: Date = new Date(),
  policies?: SlaPolicy[],
): { dueDate: string; slaStatus: SlaStatus } {
  const created = new Date(r.createdAt as unknown as string);

  // Policy-based computation
  if (policies && policies.length > 0) {
    const policy = resolvePolicy(policies, r.priority, null);
    if (policy) {
      const { status, deadlines } = evaluateSlaStatus(now, created, policy);
      return { dueDate: deadlines.resolutionDeadline.toISOString(), slaStatus: status };
    }
  }

  // Legacy fallback: simple day-based computation
  const due = new Date(created.getTime() + slaDays(r.priority) * 24 * 60 * 60 * 1000);
  const totalWindow = due.getTime() - created.getTime();
  const elapsed = now.getTime() - created.getTime();
  const threshold = totalWindow * 0.8;

  let slaStatus: SlaStatus;
  if (elapsed >= totalWindow) slaStatus = "breached";
  else if (elapsed >= threshold) slaStatus = "at_risk";
  else slaStatus = "within_sla";

  return { dueDate: due.toISOString(), slaStatus };
}

/** Load SLA policies for a given tenant. Returns empty array if none configured. */
export async function loadPolicies(tenantId: string): Promise<SlaPolicy[]> {
  try {
    // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
    // before this read — a bare db.select() runs with no RLS GUC set.
    const rows = await db.transaction((tx) =>
      tx.select().from(slaPolicies).where(eq(slaPolicies.tenantId, tenantId)),
    );
    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      priority: r.priority,
      category: r.category,
      responseMinutes: r.responseMinutes,
      resolutionMinutes: r.resolutionMinutes,
    }));
  } catch {
    // Table may not exist yet if migration hasn't run — return empty
    return [];
  }
}

/** Build effective policies: tenant-configured or defaults. */
export async function getEffectivePolicies(tenantId: string): Promise<SlaPolicy[]> {
  const tenantPolicies = await loadPolicies(tenantId);
  if (tenantPolicies.length > 0) return tenantPolicies;
  return DEFAULT_SLA_POLICIES.map((p, i) => ({
    id: `default-${i}`,
    tenantId,
    ...p,
  }));
}

export function toView(r: TicketRow): TicketView {
  const sla = computeSla(r);
  return {
    id: r.id,
    subject: r.subject,
    priority: mapPriority(r.priority),
    status: mapStatus(r.status),
    dueDate: sla.dueDate,
    slaStatus: sla.slaStatus,
    ...(r.assigneeId ? { assignee: r.assigneeId } : {}),
  };
}

export async function findById(id: string, tenantId: string): Promise<TicketView | null> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const rows = await db.transaction((tx) => tx.select().from(tickets).where(eq(tickets.id, id)).limit(1));
  const row = rows[0];
  if (!row || row.tenantId !== tenantId) return null;
  return toView(row);
}

/** Raw row fetch (tenant-scoped) — used by consumers that need full columns. */
export async function findRow(id: string, tenantId: string): Promise<TicketRow | null> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const rows = await db.transaction((tx) =>
    tx.select().from(tickets)
      .where(and(eq(tickets.id, id), eq(tickets.tenantId, tenantId))).limit(1),
  );
  return rows[0] ?? null;
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<TicketView[]> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const rows = await db.transaction((tx) =>
    tx.select().from(tickets)
      .where(eq(tickets.tenantId, tenantId))
      /* C-05: Sort by SLA urgency — soonest dueDate first so most-at-risk tickets surface at top */
      .orderBy(asc(tickets.createdAt))
      .limit(limit)
      .offset(offset),
  );
  // Post-sort: breached → at_risk → within_sla for the SLA queue view
  const views = rows.map(toView);
  const slaPriority: Record<string, number> = { breached: 0, at_risk: 1, within_sla: 2 };
  return views.sort((a, b) => {
    const ap = slaPriority[a.slaStatus ?? "within_sla"] ?? 2;
    const bp = slaPriority[b.slaStatus ?? "within_sla"] ?? 2;
    if (ap !== bp) return ap - bp;
    // Within same SLA status, sort by dueDate ascending
    return new Date(a.dueDate ?? 0).getTime() - new Date(b.dueDate ?? 0).getTime();
  });
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: TicketInsert): Promise<void> {
  await tx.insert(tickets).values(row);
}

// ---------------------------------------------------------------------------
// HD1 — SLA sweeper support
// ---------------------------------------------------------------------------

/**
 * Candidate tickets for the SLA-breach sweeper: still-open (not closed/resolved)
 * and missing at least one SLA notification marker. Whether each is actually
 * at-risk/breached is decided in-process by computeSla() against `now`.
 *
 * CROSS-TENANT SCAN — runs on the BYPASSRLS helpdesk_scanner pool
 * (shared/scanner-db.ts, migration 0016): this background sweeper deliberately
 * polls across ALL tenants in one query (sweepSlaBreaches() then groups the
 * results by tenantId). Under the NOBYPASSRLS helpdesk_svc role (#146) a bare
 * cross-tenant SELECT returns zero rows, so the scan uses scannerDb — the
 * bypass-RLS-role design this comment previously called the correct long-term
 * fix. Per-tenant writes derived from these candidates ARE tenant-scoped — see
 * sweepSlaBreaches() in ./sweeper.ts, which wraps each tenant's batch in
 * runWithTenant(tenantId, ...) before writing.
 */
export async function findOpenForSla(batch = 200): Promise<TicketRow[]> {
  return scannerDb.select().from(tickets)
    .where(and(
      notInArray(tickets.status, ["closed", "resolved"]),
      or(isNull(tickets.slaAtRiskNotifiedAt), isNull(tickets.slaBreachedNotifiedAt)),
    ))
    .limit(batch);
}

/**
 * Stamp the SLA notification marker for `stage` only if still unset — a CAS so
 * overlapping sweeps (and re-runs) notify exactly once. Returns true if THIS
 * call claimed the stamp (caller should then emit notify/escalation/audit).
 */
export async function markSlaNotified(
  tx: Writer,
  id: string,
  tenantId: string,
  stage: "at_risk" | "breached",
  now: Date,
): Promise<boolean> {
  const col = stage === "breached" ? tickets.slaBreachedNotifiedAt : tickets.slaAtRiskNotifiedAt;
  const set = stage === "breached"
    ? { slaBreachedNotifiedAt: now, updatedAt: now }
    : { slaAtRiskNotifiedAt: now, updatedAt: now };
  const res = await (tx as typeof db).update(tickets)
    .set(set)
    .where(and(eq(tickets.id, id), eq(tickets.tenantId, tenantId), isNull(col)))
    .returning({ id: tickets.id });
  return res.length > 0;
}

// ---------------------------------------------------------------------------
// HD2 — inbound linkage + assignment support
// ---------------------------------------------------------------------------

/** Look up an existing ticket auto-opened from a foreign (source, source_ref). */
export async function findBySource(tenantId: string, source: string, sourceRef: string): Promise<TicketRow | null> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const rows = await db.transaction((tx) =>
    tx.select().from(tickets)
      .where(and(eq(tickets.tenantId, tenantId), eq(tickets.source, source), eq(tickets.sourceRef, sourceRef)))
      .limit(1),
  );
  return rows[0] ?? null;
}

/**
 * Idempotently open a ticket linked to a foreign event. Returns the row id
 * (existing or freshly inserted) and whether it was newly created.
 *
 * Two layers of idempotency:
 *  1. check-then-insert on (tenant, source, source_ref) inside the caller's tx —
 *     a redelivery that finds an existing linked ticket is a no-op;
 *  2. the partial UNIQUE index uq_tickets_source_ref is the race backstop: a
 *     truly-concurrent second insert hits a unique violation, which we catch and
 *     resolve to the now-existing row. (The partial index can't be an ON CONFLICT
 *     target via Drizzle, hence the catch instead of onConflictDoNothing.)
 */
export async function insertLinkedIdempotent(
  tx: Writer,
  row: TicketInsert & { source: string; sourceRef: string },
): Promise<{ id: string; created: boolean }> {
  const existing = await findBySourceTx(tx, row.tenantId, row.source, row.sourceRef);
  if (existing) return { id: existing.id, created: false };
  try {
    const res = await (tx as typeof db).insert(tickets).values(row).returning({ id: tickets.id });
    return { id: res[0]!.id, created: true };
  } catch (err) {
    // unique-violation race: another concurrent insert won — resolve to it.
    if (isUniqueViolation(err)) {
      const now = await findBySourceTx(tx, row.tenantId, row.source, row.sourceRef);
      if (now) return { id: now.id, created: false };
    }
    throw err;
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

/** findBySource scoped to a transaction (for read-your-write inside the tx). */
async function findBySourceTx(tx: Writer, tenantId: string, source: string, sourceRef: string): Promise<TicketRow | null> {
  const rows = await (tx as typeof db).select().from(tickets)
    .where(and(eq(tickets.tenantId, tenantId), eq(tickets.source, source), eq(tickets.sourceRef, sourceRef)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Assign a ticket to an agent (tenant-scoped). Moves status open→assigned only
 * if currently open, bumps version. Returns the updated row, or null if the
 * ticket does not exist in this tenant.
 */
export async function assign(
  tx: Writer,
  id: string,
  tenantId: string,
  assigneeId: string,
  actorId: string,
  now: Date,
): Promise<TicketRow | null> {
  const res = await (tx as typeof db).update(tickets)
    .set({
      assigneeId,
      status: "assigned",
      updatedBy: actorId,
      updatedAt: now,
      version: sql`${tickets.version} + 1`,
    })
    .where(and(eq(tickets.id, id), eq(tickets.tenantId, tenantId)))
    .returning();
  return res[0] ?? null;
}

/**
 * Transition a ticket's status (ITIL workflow). Tenant-scoped, bumps version.
 * Returns the updated row, or null if not found.
 */
export async function transitionStatus(
  tx: Writer,
  id: string,
  tenantId: string,
  newStatus: string,
  actorId: string,
  now: Date,
): Promise<TicketRow | null> {
  const res = await (tx as typeof db).update(tickets)
    .set({
      status: newStatus,
      updatedBy: actorId,
      updatedAt: now,
      version: sql`${tickets.version} + 1`,
    })
    .where(and(eq(tickets.id, id), eq(tickets.tenantId, tenantId)))
    .returning();
  return res[0] ?? null;
}

/**
 * Update a ticket's priority (used by TKT-09 bulk set_priority). Tenant-scoped,
 * bumps version. Returns the updated row, or null if not found.
 */
export async function updatePriority(
  tx: Writer,
  id: string,
  tenantId: string,
  priority: string,
  actorId: string,
  now: Date,
): Promise<TicketRow | null> {
  const res = await (tx as typeof db).update(tickets)
    .set({
      priority,
      updatedBy: actorId,
      updatedAt: now,
      version: sql`${tickets.version} + 1`,
    })
    .where(and(eq(tickets.id, id), eq(tickets.tenantId, tenantId)))
    .returning();
  return res[0] ?? null;
}

/**
 * TKT-14 — reopen a ticket. Atomically transitions resolved/closed → open in a
 * single guarded UPDATE (no separate read-then-write race window). Returns the
 * updated row, or null if the ticket does not exist in this tenant OR is not
 * currently resolved/closed (already-open redelivery is a safe no-op).
 */
export async function reopenIfClosed(
  tx: Writer,
  id: string,
  tenantId: string,
  actorId: string,
  now: Date,
): Promise<TicketRow | null> {
  const res = await (tx as typeof db).update(tickets)
    .set({
      status: "open",
      updatedBy: actorId,
      updatedAt: now,
      version: sql`${tickets.version} + 1`,
    })
    .where(and(
      eq(tickets.id, id),
      eq(tickets.tenantId, tenantId),
      or(eq(tickets.status, "resolved"), eq(tickets.status, "closed")),
    ))
    .returning();
  return res[0] ?? null;
}

// ---------------------------------------------------------------------------
// TKT-04 — ticket notes
// ---------------------------------------------------------------------------

/**
 * Insert a note. Idempotent on `id` (the route mints the note id and reuses it
 * as the command's messageId, so a redelivery carries the SAME row id) — a
 * second insert of the identical id is a no-op via onConflictDoNothing.
 * Returns the row if inserted, or null if it already existed (duplicate id).
 */
export async function insertNoteIdempotent(tx: Writer, row: TicketNoteInsert): Promise<TicketNoteRow | null> {
  const res = await (tx as typeof db).insert(ticketNotes).values(row).onConflictDoNothing().returning();
  return res[0] ?? null;
}

export async function listNotes(tenantId: string, ticketId: string, includeInternal: boolean): Promise<TicketNoteRow[]> {
  return scopedRead(async (tx) => {
    const conds = [eq(ticketNotes.tenantId, tenantId), eq(ticketNotes.ticketId, ticketId)];
    if (!includeInternal) conds.push(eq(ticketNotes.visibility, "public"));
    return tx.select().from(ticketNotes).where(and(...conds)).orderBy(asc(ticketNotes.createdAt));
  });
}

// ---------------------------------------------------------------------------
// TKT-07 — ticket transfers
// ---------------------------------------------------------------------------

/** Most recent transfer's destination department, i.e. the ticket's current department. */
export async function getCurrentDepartment(tx: Writer, tenantId: string, ticketId: string): Promise<string | null> {
  const rows = await (tx as typeof db).select().from(ticketTransfers)
    .where(and(eq(ticketTransfers.tenantId, tenantId), eq(ticketTransfers.ticketId, ticketId)))
    .orderBy(desc(ticketTransfers.transferredAt))
    .limit(1);
  return rows[0]?.toDepartment ?? null;
}

/**
 * Insert a transfer audit row. Idempotent on `id` (mirrors insertNoteIdempotent —
 * the route mints the transfer id and reuses it as the messageId).
 */
export async function insertTransferIdempotent(tx: Writer, row: TicketTransferInsert): Promise<TicketTransferRow | null> {
  const res = await (tx as typeof db).insert(ticketTransfers).values(row).onConflictDoNothing().returning();
  return res[0] ?? null;
}

// ---------------------------------------------------------------------------
// TKT-08 — ticket links
// ---------------------------------------------------------------------------

/** Inverse relationship for the directional link types (parent <-> child). */
const INVERSE_LINK_TYPE: Record<string, string> = {
  parent: "child",
  child: "parent",
  duplicate: "duplicate",
  related: "related",
};

/**
 * Look up an existing link representing the SAME relationship, in either
 * direction — (source,target,type) or the symmetric (target,source,inverseType)
 * pairing. e.g. "A parent-of B" already covers "B child-of A"; "A duplicate B"
 * already covers "B duplicate A".
 */
async function findExistingLink(
  tx: Writer,
  tenantId: string,
  sourceTicketId: string,
  targetTicketId: string,
  linkType: string,
): Promise<TicketLinkRow | null> {
  const inverse = INVERSE_LINK_TYPE[linkType] ?? linkType;
  const rows = await (tx as typeof db).select().from(ticketLinks)
    .where(and(
      eq(ticketLinks.tenantId, tenantId),
      or(
        and(
          eq(ticketLinks.sourceTicketId, sourceTicketId),
          eq(ticketLinks.targetTicketId, targetTicketId),
          eq(ticketLinks.linkType, linkType),
        ),
        and(
          eq(ticketLinks.sourceTicketId, targetTicketId),
          eq(ticketLinks.targetTicketId, sourceTicketId),
          eq(ticketLinks.linkType, inverse),
        ),
      ),
    ))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Idempotently link two tickets. Symmetric-safe: a redelivery, OR the inverse
 * relationship submitted separately (e.g. B "child" of A after A "parent" of B
 * already exists), resolves to the existing row instead of inserting a
 * duplicate pair. Returns the row id and whether it was newly created.
 */
export async function insertLinkIdempotent(
  tx: Writer,
  row: TicketLinkInsert,
): Promise<{ id: string; created: boolean }> {
  const existing = await findExistingLink(tx, row.tenantId, row.sourceTicketId, row.targetTicketId, row.linkType);
  if (existing) return { id: existing.id, created: false };
  try {
    const res = await (tx as typeof db).insert(ticketLinks).values(row).returning({ id: ticketLinks.id });
    return { id: res[0]!.id, created: true };
  } catch (err) {
    if (isUniqueViolation(err)) {
      const now = await findExistingLink(tx, row.tenantId, row.sourceTicketId, row.targetTicketId, row.linkType);
      if (now) return { id: now.id, created: false };
    }
    throw err;
  }
}

export async function listLinks(tenantId: string, ticketId: string): Promise<TicketLinkRow[]> {
  return scopedRead(async (tx) =>
    tx.select().from(ticketLinks).where(and(
      eq(ticketLinks.tenantId, tenantId),
      or(eq(ticketLinks.sourceTicketId, ticketId), eq(ticketLinks.targetTicketId, ticketId)),
    )),
  );
}

export { mapStatus, mapPriority };
