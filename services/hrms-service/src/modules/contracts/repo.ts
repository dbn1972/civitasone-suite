import { cache } from "../../shared/infra.js";
import { db, scopedRead } from "../../shared/db.js";
import {
  hrmsContracts,
  hrmsContractRenewals,
  hrmsContractNotifications,
  hrmsContractConfig,
  hrmsContractSeq,
} from "./schema.js";
import { eq, and, sql, desc, asc, gte, lte, inArray, type SQL } from "drizzle-orm";
import { hrmsEmployees } from "../employee/schema.js";
import { addDaysToDateOnly } from "../../shared/ist.js";

const SERVICE = "hrms";

// ─── Contract reads ──────────────────────────────────────────────────────────

export async function getContractById(tenantId: string, id: string) {
  return cache.getOrLoad(`${SERVICE}:${tenantId}:contract:${id}`, async () => {
    const rows = await scopedRead((tx) =>
      tx
        .select()
        .from(hrmsContracts)
        .where(
          and(
            eq(hrmsContracts.tenantId, tenantId),
            eq(hrmsContracts.id, id),
          ),
        )
        .limit(1),
    );
    return rows[0] ?? null;
  });
}

/**
 * Tx-scoped variant of getContractById: reads through the caller's already-
 * open transaction instead of opening a nested one via scopedRead (and
 * skips the cache layer entirely -- a transaction-scoped read must see the
 * authoritative, possibly-uncommitted state, not a cached value). Every
 * consumer in this file that reads a contract from inside its own
 * db.transaction() must use this, not getContractById -- calling the
 * scopedRead-based version there opens a SECOND transaction competing for a
 * connection from the same pool as the outer one, deadlocking every
 * in-flight command once concurrency reaches pool.max (see
 * .claude/skills/16-production-readiness-audit.md section 1).
 */
export async function getContractByIdTx(tx: any, tenantId: string, id: string) {
  const rows = await tx
    .select()
    .from(hrmsContracts)
    .where(and(eq(hrmsContracts.tenantId, tenantId), eq(hrmsContracts.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getActiveContractForEmployee(
  tenantId: string,
  employeeId: string,
) {
  return cache.getOrLoad(
    `${SERVICE}:${tenantId}:contract:employee:${employeeId}:active`,
    async () => {
      const rows = await scopedRead((tx) =>
        tx
          .select()
          .from(hrmsContracts)
          .where(
            and(
              eq(hrmsContracts.tenantId, tenantId),
              eq(hrmsContracts.employeeId, employeeId),
              eq(hrmsContracts.status, "active"),
            ),
          )
          .limit(1),
      );
      return rows[0] ?? null;
    },
  );
}

/**
 * Tx-scoped variant of getActiveContractForEmployee -- see getContractByIdTx
 * for why.
 */
export async function getActiveContractForEmployeeTx(tx: any, tenantId: string, employeeId: string) {
  const rows = await tx
    .select()
    .from(hrmsContracts)
    .where(
      and(
        eq(hrmsContracts.tenantId, tenantId),
        eq(hrmsContracts.employeeId, employeeId),
        eq(hrmsContracts.status, "active"),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function getContractHistory(
  tenantId: string,
  employeeId: string,
) {
  return cache.getOrLoad(
    `${SERVICE}:${tenantId}:contract:employee:${employeeId}:history`,
    async () => {
      return scopedRead((tx) =>
        tx
          .select()
          .from(hrmsContracts)
          .where(
            and(
              eq(hrmsContracts.tenantId, tenantId),
              eq(hrmsContracts.employeeId, employeeId),
            ),
          )
          .orderBy(hrmsContracts.startDate),
      );
    },
  );
}

/** Tx-scoped variant of getContractHistory — see getContractByIdTx for why. */
export async function getContractHistoryTx(tx: any, tenantId: string, employeeId: string) {
  return tx
    .select()
    .from(hrmsContracts)
    .where(and(eq(hrmsContracts.tenantId, tenantId), eq(hrmsContracts.employeeId, employeeId)))
    .orderBy(hrmsContracts.startDate);
}

/** A contract still in force expiring within this many days counts as "expiring" on the register. */
export const CONTRACT_EXPIRING_WINDOW_DAYS = 30;

export interface ContractListSummary {
  active: number;
  expiring: number;
  expired: number;
  agencies: number;
}

/**
 * Full-scope register counts, classified by contract status AND end date against
 * `today` (the IST calendar date, "YYYY-MM-DD"). Disjoint where it matters:
 *   active    status 'active' and not past its end date
 *   expiring  still in force (end >= today) and either status 'expiring', or
 *             active/escalated ending within CONTRACT_EXPIRING_WINDOW_DAYS
 *   expired   status 'expired', or still-open (active/expiring/escalated) and
 *             past its end date
 * terminated / renewed / draft contracts are in none of the three. `agencies`
 * is the number of distinct agency refs among the employees in scope.
 */
export async function summarizeContracts(
  tenantId: string,
  conds: SQL[],
  today: string,
): Promise<ContractListSummary> {
  const soon = addDaysToDateOnly(today, CONTRACT_EXPIRING_WINDOW_DAYS) ?? today;
  const where = and(...conds);
  const counts = await scopedRead((tx) =>
    tx
      .select({
        active: sql<number>`count(*) filter (where ${hrmsContracts.status} = 'active' and ${hrmsContracts.endDate} >= ${today}::date)::int`,
        expiring: sql<number>`count(*) filter (where ${hrmsContracts.endDate} >= ${today}::date and (${hrmsContracts.status} = 'expiring' or (${hrmsContracts.status} in ('active', 'escalated') and ${hrmsContracts.endDate} <= ${soon}::date)))::int`,
        expired: sql<number>`count(*) filter (where ${hrmsContracts.status} = 'expired' or (${hrmsContracts.status} in ('active', 'expiring', 'escalated') and ${hrmsContracts.endDate} < ${today}::date))::int`,
      })
      .from(hrmsContracts)
      .where(where),
  );
  // Agencies live on the employee row (cross-module table, read-only, tenant-scoped) -- two
  // plain queries rather than a SQL join across module schemas.
  const empIdRows = await scopedRead((tx) =>
    tx.selectDistinct({ employeeId: hrmsContracts.employeeId }).from(hrmsContracts).where(where),
  );
  const employeeIds = empIdRows.map((r) => r.employeeId);
  let agencies = 0;
  if (employeeIds.length > 0) {
    const agencyRows = await scopedRead((tx) =>
      tx
        .select({ n: sql<number>`count(distinct ${hrmsEmployees.agencyRef})::int` })
        .from(hrmsEmployees)
        .where(and(eq(hrmsEmployees.tenantId, tenantId), inArray(hrmsEmployees.id, employeeIds))),
    );
    agencies = agencyRows[0]?.n ?? 0;
  }
  return {
    active: counts[0]?.active ?? 0,
    expiring: counts[0]?.expiring ?? 0,
    expired: counts[0]?.expired ?? 0,
    agencies,
  };
}

export async function listContracts(
  tenantId: string,
  filters: { employeeId?: string; employeeIds?: string[]; status?: string },
  pagination: { limit: number; offset: number },
  opts: { sort?: "endDate"; summaryToday?: string } = {},
) {
  const conds = [eq(hrmsContracts.tenantId, tenantId)];
  if (filters.employeeId)
    conds.push(eq(hrmsContracts.employeeId, filters.employeeId));
  // Manager scope (W1 owner decision 2): an empty set matches nothing.
  if (filters.employeeIds)
    conds.push(filters.employeeIds.length > 0 ? inArray(hrmsContracts.employeeId, filters.employeeIds) : sql`false`);
  if (filters.status) conds.push(eq(hrmsContracts.status, filters.status));

  const rows = await scopedRead((tx) =>
    tx
      .select()
      .from(hrmsContracts)
      .where(and(...conds))
      .orderBy(...(opts.sort === "endDate"
        ? [asc(hrmsContracts.endDate), asc(hrmsContracts.id)]
        : [desc(hrmsContracts.createdAt)]))
      .limit(pagination.limit)
      .offset(pagination.offset),
  );

  const countRows = await scopedRead((tx) =>
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(hrmsContracts)
      .where(and(...conds)),
  );
  const total = countRows[0]?.count ?? 0;

  return {
    data: rows,
    meta: {
      page: Math.floor(pagination.offset / pagination.limit) + 1,
      pageSize: pagination.limit,
      total,
      ...(opts.summaryToday ? { summary: await summarizeContracts(tenantId, conds, opts.summaryToday) } : {}),
    },
  };
}

// ─── Renewal reads ───────────────────────────────────────────────────────────

export async function getRenewalById(tenantId: string, id: string) {
  return cache.getOrLoad(
    `${SERVICE}:${tenantId}:contract:renewal:${id}`,
    async () => {
      const rows = await scopedRead((tx) =>
        tx
          .select()
          .from(hrmsContractRenewals)
          .where(
            and(
              eq(hrmsContractRenewals.tenantId, tenantId),
              eq(hrmsContractRenewals.id, id),
            ),
          )
          .limit(1),
      );
      return rows[0] ?? null;
    },
  );
}

/** Tx-scoped variant of getRenewalById — see getContractByIdTx for why. */
export async function getRenewalByIdTx(tx: any, tenantId: string, id: string) {
  const rows = await tx
    .select()
    .from(hrmsContractRenewals)
    .where(and(eq(hrmsContractRenewals.tenantId, tenantId), eq(hrmsContractRenewals.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getPendingRenewalForContract(
  tenantId: string,
  contractId: string,
) {
  const rows = await scopedRead((tx) =>
    tx
      .select()
      .from(hrmsContractRenewals)
      .where(
        and(
          eq(hrmsContractRenewals.tenantId, tenantId),
          eq(hrmsContractRenewals.contractId, contractId),
          eq(hrmsContractRenewals.status, "pending_approval"),
        ),
      )
      .limit(1),
  );
  return rows[0] ?? null;
}

/** Tx-scoped variant of getPendingRenewalForContract — see getContractByIdTx for why. */
export async function getPendingRenewalForContractTx(tx: any, tenantId: string, contractId: string) {
  const rows = await tx
    .select()
    .from(hrmsContractRenewals)
    .where(
      and(
        eq(hrmsContractRenewals.tenantId, tenantId),
        eq(hrmsContractRenewals.contractId, contractId),
        eq(hrmsContractRenewals.status, "pending_approval"),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function listRenewals(
  tenantId: string,
  filters: { contractId?: string; employeeId?: string; employeeIds?: string[]; status?: string },
  pagination: { limit: number; offset: number },
) {
  const conds = [eq(hrmsContractRenewals.tenantId, tenantId)];
  // Renewals carry no employee_id: scope through the owning contract.
  const scopeIds = filters.employeeId
    ? (filters.employeeIds && !filters.employeeIds.includes(filters.employeeId) ? [] : [filters.employeeId])
    : filters.employeeIds;
  if (scopeIds)
    conds.push(scopeIds.length > 0
      ? inArray(hrmsContractRenewals.contractId, sql`(select id from contracts.hrms_contracts where tenant_id = ${tenantId} and employee_id in (${sql.join(scopeIds.map((i) => sql`${i}`), sql`, `)}))`)
      : sql`false`);
  if (filters.contractId)
    conds.push(eq(hrmsContractRenewals.contractId, filters.contractId));
  if (filters.status)
    conds.push(eq(hrmsContractRenewals.status, filters.status));

  const rows = await scopedRead((tx) =>
    tx
      .select()
      .from(hrmsContractRenewals)
      .where(and(...conds))
      .orderBy(desc(hrmsContractRenewals.createdAt))
      .limit(pagination.limit)
      .offset(pagination.offset),
  );

  const countRows = await scopedRead((tx) =>
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(hrmsContractRenewals)
      .where(and(...conds)),
  );
  const total = countRows[0]?.count ?? 0;

  return {
    data: rows,
    meta: {
      page: Math.floor(pagination.offset / pagination.limit) + 1,
      pageSize: pagination.limit,
      total,
    },
  };
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

export async function getExpiringContractsDashboard(tenantId: string) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    .toISOString()
    .slice(0, 10);

  return cache.getOrLoad(
    `${SERVICE}:${tenantId}:contract:dashboard:expiring`,
    async () => {
      return scopedRead((tx) =>
        tx
          .select()
          .from(hrmsContracts)
          .where(
            and(
              eq(hrmsContracts.tenantId, tenantId),
              inArray(hrmsContracts.status, ["active", "expiring"]),
              gte(hrmsContracts.endDate, monthStart),
              lte(hrmsContracts.endDate, monthEnd),
            ),
          )
          .orderBy(hrmsContracts.endDate),
      );
    },
  );
}

// ─── Config ──────────────────────────────────────────────────────────────────

export async function getContractConfig(tenantId: string) {
  return cache.getOrLoad(
    `${SERVICE}:${tenantId}:contract:config`,
    async () => {
      const rows = await scopedRead((tx) =>
        tx
          .select()
          .from(hrmsContractConfig)
          .where(eq(hrmsContractConfig.tenantId, tenantId))
          .limit(1),
      );
      return rows[0] ?? null;
    },
  );
}

/** Tx-scoped variant of getContractConfig — see getContractByIdTx for why. */
export async function getContractConfigTx(tx: any, tenantId: string) {
  const rows = await tx
    .select()
    .from(hrmsContractConfig)
    .where(eq(hrmsContractConfig.tenantId, tenantId))
    .limit(1);
  return rows[0] ?? null;
}

// ─── Sequence ────────────────────────────────────────────────────────────────

export async function getNextContractNo(
  tx: any,
  tenantId: string,
): Promise<string> {
  // Atomic increment — upsert the sequence counter
  const result = await tx
    .insert(hrmsContractSeq)
    .values({ tenantId, nextVal: 1 })
    .onConflictDoUpdate({
      target: hrmsContractSeq.tenantId,
      set: { nextVal: sql`${hrmsContractSeq.nextVal} + 1` },
    })
    .returning({ nextVal: hrmsContractSeq.nextVal });
  const seq = result[0]?.nextVal ?? 1;
  const year = new Date().getFullYear();
  return `CON-${year}-${String(seq).padStart(6, "0")}`;
}

// ─── Notification dedup ──────────────────────────────────────────────────────

export async function getSentMilestones(
  tenantId: string,
  contractId: string,
): Promise<number[]> {
  const rows = await scopedRead((tx) =>
    tx
      .select({ milestone: hrmsContractNotifications.milestone })
      .from(hrmsContractNotifications)
      .where(
        and(
          eq(hrmsContractNotifications.tenantId, tenantId),
          eq(hrmsContractNotifications.contractId, contractId),
        ),
      ),
  );
  return rows.map((r) => r.milestone);
}
