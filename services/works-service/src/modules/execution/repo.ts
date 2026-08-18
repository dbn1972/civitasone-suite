import { eq, and, desc, gte, lte, inArray } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { workScopes, scopeProgress, workIssues, workClosures, physicalCompletions } from "./schema.js";
import { workProposals } from "../proposal/schema.js";
import type { ReportFilters } from "../reporting/validators.js";

export async function listScopes(tenantId: string, workId: string) {
  return scopedRead(async (tx) => {
    return tx.select().from(workScopes)
      .where(and(eq(workScopes.tenantId, tenantId), eq(workScopes.workId, workId)));
  });
}

export async function listIssues(tenantId: string, workId: string) {
  return scopedRead(async (tx) => {
    return tx.select().from(workIssues)
      .where(and(eq(workIssues.tenantId, tenantId), eq(workIssues.workId, workId)));
  });
}

export async function hasPhysicalCompletion(tenantId: string, workId: string): Promise<boolean> {
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(physicalCompletions)
      .where(and(eq(physicalCompletions.tenantId, tenantId), eq(physicalCompletions.workId, workId)))
      .limit(1);
    return rows.length > 0;
  });
}

/**
 * Tenant-wide execution progress register — every recorded scope-progress
 * entry joined back to its parent work-scope (for workId/scopeId/target),
 * newest reporting period first. Backs the FE execution list page.
 */
export async function listExecutionProgress(tenantId: string, page: number, pageSize: number) {
  return scopedRead(async (tx) => {
    return tx
      .select({
        id: scopeProgress.id,
        workScopeId: scopeProgress.workScopeId,
        workId: workScopes.workId,
        scopeId: workScopes.scopeId,
        targetValue: workScopes.targetValue,
        description: workScopes.description,
        month: scopeProgress.month,
        year: scopeProgress.year,
        priorAchievement: scopeProgress.priorAchievement,
        currentAchievement: scopeProgress.currentAchievement,
        percentage: scopeProgress.percentage,
        version: scopeProgress.version,
      })
      .from(scopeProgress)
      .innerJoin(workScopes, eq(workScopes.id, scopeProgress.workScopeId))
      .where(eq(scopeProgress.tenantId, tenantId))
      .orderBy(desc(scopeProgress.year), desc(scopeProgress.month))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
  });
}

/** Tenant-wide issues register, newest first — backs the FE execution issues list. */
export async function listAllIssues(tenantId: string, page: number, pageSize: number) {
  return scopedRead(async (tx) => {
    return tx.select().from(workIssues)
      .where(eq(workIssues.tenantId, tenantId))
      .orderBy(desc(workIssues.raisedDate))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
  });
}

/** Tenant-wide closure register (closed | dropped | completion), newest first — backs the FE closure list page. */
export async function listClosures(tenantId: string, page: number, pageSize: number) {
  return scopedRead(async (tx) => {
    return tx
      .select({
        id: workClosures.id,
        tenantId: workClosures.tenantId,
        workId: workClosures.workId,
        closureType: workClosures.closureType,
        closedDate: workClosures.closedDate,
        remarks: workClosures.remarks,
        version: workClosures.version,
        workNumber: workProposals.workNumber,
        description: workProposals.description,
      })
      .from(workClosures)
      .leftJoin(workProposals, eq(workProposals.id, workClosures.workId))
      .where(eq(workClosures.tenantId, tenantId))
      .orderBy(desc(workClosures.closedDate))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
  });
}

/** Count of closed works for a tenant — feeds the works reporting summary. */
export async function countClosures(
  tenantId: string,
  filters?: Pick<ReportFilters, "fromDate" | "toDate" | "divisionId">,
): Promise<number> {
  return scopedRead(async (tx) => {
    if (!filters?.fromDate && !filters?.toDate && !filters?.divisionId) {
      const rows = await tx.select().from(workClosures).where(eq(workClosures.tenantId, tenantId));
      return rows.length;
    }

    const proposalRows = await tx.select({ id: workProposals.id })
      .from(workProposals)
      .where(and(
        eq(workProposals.tenantId, tenantId),
        ...(filters?.fromDate ? [gte(workProposals.createdAt, filters.fromDate)] : []),
        ...(filters?.toDate ? [lte(workProposals.createdAt, filters.toDate)] : []),
        ...(filters?.divisionId ? [eq(workProposals.executingDivisionId, filters.divisionId)] : []),
      ));
    const workIds = proposalRows.map((r) => r.id);
    if (workIds.length === 0) return 0;

    const closureConditions = [
      eq(workClosures.tenantId, tenantId),
      inArray(workClosures.workId, workIds),
    ];
    if (filters?.fromDate) closureConditions.push(gte(workClosures.closedDate, filters.fromDate));
    if (filters?.toDate) closureConditions.push(lte(workClosures.closedDate, filters.toDate));

    const rows = await tx.select().from(workClosures).where(and(...closureConditions));
    return rows.length;
  });
}
