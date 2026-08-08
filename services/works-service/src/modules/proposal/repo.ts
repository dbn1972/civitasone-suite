import { eq, and, sql, gte, lte, desc } from "drizzle-orm";
import { cache } from "../../shared/infra.js";
import { scopedRead } from "../../shared/db.js";
import { workProposals, workSplits, workCoaMappings, workOfficeMappings } from "./schema.js";
import type { ReportFilters } from "../reporting/validators.js";

function proposalConditions(tenantId: string, filters?: Pick<ReportFilters, "fromDate" | "toDate" | "divisionId">) {
  const conditions = [eq(workProposals.tenantId, tenantId)];
  if (filters?.fromDate) conditions.push(gte(workProposals.createdAt, filters.fromDate));
  if (filters?.toDate) conditions.push(lte(workProposals.createdAt, filters.toDate));
  if (filters?.divisionId) conditions.push(eq(workProposals.executingDivisionId, filters.divisionId));
  return conditions;
}

export async function getProposal(tenantId: string, id: string) {
  return cache.getOrLoad(`works:${tenantId}:proposal:${id}`, async () => {
    return scopedRead(async (tx) => {
      const rows = await tx.select().from(workProposals)
        .where(and(eq(workProposals.id, id), eq(workProposals.tenantId, tenantId)));
      return rows[0] ?? null;
    });
  });
}

export async function listProposals(tenantId: string, page: number, pageSize: number) {
  return scopedRead(async (tx) => {
    return tx.select().from(workProposals)
      .where(eq(workProposals.tenantId, tenantId))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
  });
}

export async function listSplits(tenantId: string, parentWorkId: string) {
  return scopedRead(async (tx) => {
    return tx.select().from(workSplits)
      .where(and(eq(workSplits.tenantId, tenantId), eq(workSplits.parentWorkId, parentWorkId)));
  });
}

export async function listCoaMappings(tenantId: string, workId: string) {
  return scopedRead(async (tx) => {
    return tx.select().from(workCoaMappings)
      .where(and(eq(workCoaMappings.tenantId, tenantId), eq(workCoaMappings.workId, workId)));
  });
}

export async function listOfficeMappings(tenantId: string, workId: string) {
  return scopedRead(async (tx) => {
    return tx.select().from(workOfficeMappings)
      .where(and(eq(workOfficeMappings.tenantId, tenantId), eq(workOfficeMappings.workId, workId)));
  });
}

/** Total work-proposal count for a tenant — feeds the works reporting summary. */
export async function countProposals(
  tenantId: string,
  filters?: Pick<ReportFilters, "fromDate" | "toDate" | "divisionId">,
): Promise<number> {
  return scopedRead(async (tx) => {
    const rows = await tx
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(workProposals)
      .where(and(...proposalConditions(tenantId, filters)));
    return rows[0]?.count ?? 0;
  });
}

/** Work-proposal counts grouped by lifecycle status — feeds the works status report. */
export async function proposalStatusCounts(
  tenantId: string,
  filters?: Pick<ReportFilters, "fromDate" | "toDate" | "divisionId">,
): Promise<{ status: string; count: number }[]> {
  return scopedRead(async (tx) => {
    return tx
      .select({ status: workProposals.status, count: sql<number>`cast(count(*) as int)` })
      .from(workProposals)
      .where(and(...proposalConditions(tenantId, filters)))
      .groupBy(workProposals.status);
  });
}

/** Paginated proposal register for reporting dashboards. */
export async function listProposalsForReport(tenantId: string, filters: ReportFilters) {
  return scopedRead(async (tx) => {
    return tx.select({
      id: workProposals.id,
      workNumber: workProposals.workNumber,
      status: workProposals.status,
      category: workProposals.category,
      description: workProposals.description,
      estimatedCostMinor: workProposals.estimatedCostMinor,
      executingDivisionId: workProposals.executingDivisionId,
      createdAt: workProposals.createdAt,
    })
      .from(workProposals)
      .where(and(...proposalConditions(tenantId, filters)))
      .orderBy(desc(workProposals.createdAt))
      .limit(filters.pageSize)
      .offset((filters.page - 1) * filters.pageSize);
  });
}
