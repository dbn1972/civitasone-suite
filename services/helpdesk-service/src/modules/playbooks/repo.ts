/**
 * G13 Resolution Playbooks — repository (data access).
 *
 * Reads wrap in db.transaction() so createTenantDb's wrapWithTenantGuc injects
 * app.tenant_id from AsyncLocalStorage before the query — a bare db.select()
 * runs with no RLS GUC set and returns zero rows under this service's
 * fail-closed policies. Writers accept a `tx` so callers compose them into one
 * atomic transaction alongside the outbox enqueues.
 */
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { tickets } from "../tickets/schema.js";
import {
  playbooks,
  playbookRuns,
  playbookRunSteps,
  type PlaybookRow,
  type PlaybookInsert,
  type PlaybookRunRow,
  type PlaybookRunInsert,
  type PlaybookRunStepRow,
  type PlaybookRunStepInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select" | "delete">;

// ── Playbooks ───────────────────────────────────────────────────────────────

export async function insertPlaybook(tx: Writer, row: PlaybookInsert): Promise<PlaybookRow> {
  const res = await (tx as typeof db).insert(playbooks).values(row).returning();
  return res[0]!;
}

export async function findPlaybook(id: string, tenantId: string): Promise<PlaybookRow | null> {
  const rows = await db.transaction((tx) =>
    tx
      .select()
      .from(playbooks)
      .where(and(eq(playbooks.id, id), eq(playbooks.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

/** Same as findPlaybook but inside a caller-supplied transaction (consumers). */
export async function findPlaybookTx(
  tx: Writer,
  id: string,
  tenantId: string,
): Promise<PlaybookRow | null> {
  const rows = await (tx as typeof db)
    .select()
    .from(playbooks)
    .where(and(eq(playbooks.id, id), eq(playbooks.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findPlaybookByKeyVersion(
  tenantId: string,
  playbookKey: string,
  versionNumber: number,
): Promise<PlaybookRow | null> {
  const rows = await db.transaction((tx) =>
    tx
      .select()
      .from(playbooks)
      .where(
        and(
          eq(playbooks.tenantId, tenantId),
          eq(playbooks.playbookKey, playbookKey),
          eq(playbooks.versionNumber, versionNumber),
        ),
      )
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function listPlaybooks(
  tenantId: string,
  opts: {
    status?: string | undefined;
    playbookKey?: string | undefined;
    limit: number;
    offset: number;
  },
): Promise<PlaybookRow[]> {
  return db.transaction((tx) => {
    const conds = [eq(playbooks.tenantId, tenantId)];
    if (opts.status) conds.push(eq(playbooks.status, opts.status));
    if (opts.playbookKey) conds.push(eq(playbooks.playbookKey, opts.playbookKey));
    return tx
      .select()
      .from(playbooks)
      .where(and(...conds))
      .orderBy(asc(playbooks.playbookKey), desc(playbooks.versionNumber))
      .limit(opts.limit)
      .offset(opts.offset);
  });
}

/**
 * Candidate set for resolution. Only PUBLISHED rows leave the database — draft
 * and deprecated playbooks are filtered here as well as in the domain, so a
 * cache poisoned with a stale draft still cannot be resolved.
 */
export async function listPublishedPlaybooks(tenantId: string): Promise<PlaybookRow[]> {
  return db.transaction((tx) =>
    tx
      .select()
      .from(playbooks)
      .where(and(eq(playbooks.tenantId, tenantId), eq(playbooks.status, "published")))
      .orderBy(asc(playbooks.playbookKey), desc(playbooks.versionNumber)),
  );
}

/**
 * Patch a playbook. `expectedVersion` implements optimistic locking: when
 * supplied it is part of the WHERE, so a concurrent writer that already bumped
 * `version` makes this update match zero rows and the caller reports 409.
 */
export async function updatePlaybook(
  tx: Writer,
  id: string,
  tenantId: string,
  patch: Partial<PlaybookInsert>,
  expectedVersion?: number,
): Promise<PlaybookRow | null> {
  const conds = [eq(playbooks.id, id), eq(playbooks.tenantId, tenantId)];
  if (expectedVersion !== undefined) conds.push(eq(playbooks.version, expectedVersion));
  const res = await (tx as typeof db)
    .update(playbooks)
    .set({ ...patch, updatedAt: new Date(), version: sql`${playbooks.version} + 1` })
    .where(and(...conds))
    .returning();
  return res[0] ?? null;
}

// ── Runs ────────────────────────────────────────────────────────────────────

/**
 * Insert a run, tolerating the UNIQUE (tenant_id, ticket_id) collision.
 * Returns null when a run already existed for that ticket — which is the
 * idempotency guarantee the auto-attach consumer relies on. ON CONFLICT DO
 * NOTHING is race-free where a SELECT-then-INSERT is not.
 */
export async function insertRunIfAbsent(tx: Writer, row: PlaybookRunInsert): Promise<PlaybookRunRow | null> {
  const res = await (tx as typeof db)
    .insert(playbookRuns)
    .values(row)
    .onConflictDoNothing({ target: [playbookRuns.tenantId, playbookRuns.ticketId] })
    .returning();
  return res[0] ?? null;
}

export async function findRun(id: string, tenantId: string): Promise<PlaybookRunRow | null> {
  const rows = await db.transaction((tx) =>
    tx
      .select()
      .from(playbookRuns)
      .where(and(eq(playbookRuns.id, id), eq(playbookRuns.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

/**
 * Same as findRun but inside a caller-supplied transaction. Consumers MUST use
 * this rather than findRun: opening a nested db.transaction() from inside a
 * consumer transaction takes a second pooled connection, which cannot see the
 * uncommitted writes of the outer one and burns a connection per call.
 */
export async function findRunTx(
  tx: Writer,
  id: string,
  tenantId: string,
): Promise<PlaybookRunRow | null> {
  const rows = await (tx as typeof db)
    .select()
    .from(playbookRuns)
    .where(and(eq(playbookRuns.id, id), eq(playbookRuns.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findRunByTicket(tenantId: string, ticketId: string): Promise<PlaybookRunRow | null> {
  const rows = await db.transaction((tx) =>
    tx
      .select()
      .from(playbookRuns)
      .where(and(eq(playbookRuns.tenantId, tenantId), eq(playbookRuns.ticketId, ticketId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function updateRun(
  tx: Writer,
  id: string,
  tenantId: string,
  patch: Partial<PlaybookRunInsert>,
  expectedVersion?: number,
): Promise<PlaybookRunRow | null> {
  const conds = [eq(playbookRuns.id, id), eq(playbookRuns.tenantId, tenantId)];
  if (expectedVersion !== undefined) conds.push(eq(playbookRuns.version, expectedVersion));
  const res = await (tx as typeof db)
    .update(playbookRuns)
    .set({ ...patch, updatedAt: new Date(), version: sql`${playbookRuns.version} + 1` })
    .where(and(...conds))
    .returning();
  return res[0] ?? null;
}

// ── Run steps ───────────────────────────────────────────────────────────────

export async function insertRunSteps(
  tx: Writer,
  rows: PlaybookRunStepInsert[],
): Promise<PlaybookRunStepRow[]> {
  if (rows.length === 0) return [];
  return (tx as typeof db).insert(playbookRunSteps).values(rows).returning();
}

export async function listRunSteps(tenantId: string, runId: string): Promise<PlaybookRunStepRow[]> {
  return db.transaction((tx) =>
    tx
      .select()
      .from(playbookRunSteps)
      .where(and(eq(playbookRunSteps.tenantId, tenantId), eq(playbookRunSteps.runId, runId)))
      .orderBy(asc(playbookRunSteps.ordinal)),
  );
}

/** Same query as listRunSteps but inside a caller-supplied transaction. */
export async function listRunStepsTx(
  tx: Writer,
  tenantId: string,
  runId: string,
): Promise<PlaybookRunStepRow[]> {
  return (tx as typeof db)
    .select()
    .from(playbookRunSteps)
    .where(and(eq(playbookRunSteps.tenantId, tenantId), eq(playbookRunSteps.runId, runId)))
    .orderBy(asc(playbookRunSteps.ordinal));
}

export async function findRunStep(
  tenantId: string,
  runId: string,
  stepId: string,
): Promise<PlaybookRunStepRow | null> {
  const rows = await db.transaction((tx) =>
    tx
      .select()
      .from(playbookRunSteps)
      .where(
        and(
          eq(playbookRunSteps.tenantId, tenantId),
          eq(playbookRunSteps.runId, runId),
          eq(playbookRunSteps.stepId, stepId),
        ),
      )
      .limit(1),
  );
  return rows[0] ?? null;
}

/**
 * Stamp a step complete only if it is still incomplete — a compare-and-set so a
 * redelivered completion command does not overwrite the original actor/time.
 * Returns the row when THIS call claimed the completion, else null.
 */
export async function completeRunStep(
  tx: Writer,
  tenantId: string,
  runId: string,
  stepId: string,
  actorId: string,
  at: Date,
  note: string | null,
): Promise<PlaybookRunStepRow | null> {
  const res = await (tx as typeof db)
    .update(playbookRunSteps)
    .set({ completedAt: at, completedBy: actorId, note, updatedAt: at })
    .where(
      and(
        eq(playbookRunSteps.tenantId, tenantId),
        eq(playbookRunSteps.runId, runId),
        eq(playbookRunSteps.stepId, stepId),
        isNull(playbookRunSteps.completedAt),
      ),
    )
    .returning();
  return res[0] ?? null;
}

// ── Ticket lookup (matching criteria source) ────────────────────────────────

/**
 * The matching dimensions of a ticket.
 *
 * `productCode` has no first-class column on helpdesk.tickets, so it is read
 * from the ticket's `type_fields` JSONB (`typeFields.productCode`) — the same
 * bag the ITIL type-specific fields already use. That keeps this feature
 * additive: no change to the ticket table or its create contract.
 */
export interface TicketCriteriaRow {
  id: string;
  categoryId: string | null;
  productCode: string | null;
  ticketType: string | null;
  priority: string | null;
}

function productCodeOf(typeFields: Record<string, unknown> | null): string | null {
  const raw = typeFields?.productCode;
  return typeof raw === "string" && raw.trim() !== "" ? raw : null;
}

export async function findTicketCriteria(
  tenantId: string,
  ticketId: string,
): Promise<TicketCriteriaRow | null> {
  const rows = await db.transaction((tx) =>
    tx
      .select({
        id: tickets.id,
        categoryId: tickets.categoryId,
        ticketType: tickets.ticketType,
        priority: tickets.priority,
        typeFields: tickets.typeFields,
      })
      .from(tickets)
      .where(and(eq(tickets.id, ticketId), eq(tickets.tenantId, tenantId)))
      .limit(1),
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    categoryId: row.categoryId ?? null,
    productCode: productCodeOf(row.typeFields ?? null),
    ticketType: row.ticketType ?? null,
    priority: row.priority ?? null,
  };
}

/** Same projection as findTicketCriteria, inside a caller-supplied transaction. */
export async function findTicketCriteriaTx(
  tx: Writer,
  tenantId: string,
  ticketId: string,
): Promise<TicketCriteriaRow | null> {
  const rows = await (tx as typeof db)
    .select({
      id: tickets.id,
      categoryId: tickets.categoryId,
      ticketType: tickets.ticketType,
      priority: tickets.priority,
      typeFields: tickets.typeFields,
    })
    .from(tickets)
    .where(and(eq(tickets.id, ticketId), eq(tickets.tenantId, tenantId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    categoryId: row.categoryId ?? null,
    productCode: productCodeOf(row.typeFields ?? null),
    ticketType: row.ticketType ?? null,
    priority: row.priority ?? null,
  };
}

/** Published-playbook candidate set inside a caller-supplied transaction. */
export async function listPublishedPlaybooksTx(tx: Writer, tenantId: string): Promise<PlaybookRow[]> {
  return (tx as typeof db)
    .select()
    .from(playbooks)
    .where(and(eq(playbooks.tenantId, tenantId), eq(playbooks.status, "published")))
    .orderBy(asc(playbooks.playbookKey), desc(playbooks.versionNumber));
}
