import { eq, and, sql, gte, lte, desc, inArray, or, ilike } from "drizzle-orm";
import { cache } from "../../shared/infra.js";
import { scopedRead, db } from "../../shared/db.js";
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

/**
 * GAP-WORKS-BOQ-NEW-03: typeahead over work proposals (by work number or
 * description) for the shared EntityPicker on the BoQ Add-item form, so a
 * clerk searches for a work by its human number instead of pasting a UUID.
 * Returns the compact {id, workNumber, description} shape the picker adapter
 * maps to {id,label,sublabel}. Empty query lists the newest works.
 */
export async function searchProposals(tenantId: string, query: string, limit = 20) {
  const q = query.trim();
  const safeLimit = Math.min(Math.max(limit, 1), 50);
  return scopedRead(async (tx) => {
    const conditions = [eq(workProposals.tenantId, tenantId)];
    if (q.length > 0) {
      const like = `%${q}%`;
      const match = or(ilike(workProposals.workNumber, like), ilike(workProposals.description, like));
      if (match) conditions.push(match);
    }
    return tx
      .select({
        id: workProposals.id,
        workNumber: workProposals.workNumber,
        description: workProposals.description,
      })
      .from(workProposals)
      .where(and(...conditions))
      .orderBy(desc(workProposals.createdAt))
      .limit(safeLimit);
  });
}

/** Resolve a set of work ids to {id, workNumber, description} — EntityPicker seeding. */
export async function resolveProposals(tenantId: string, ids: string[]) {
  if (ids.length === 0) return [];
  return scopedRead(async (tx) => {
    return tx
      .select({ id: workProposals.id, workNumber: workProposals.workNumber, description: workProposals.description })
      .from(workProposals)
      .where(and(eq(workProposals.tenantId, tenantId), inArray(workProposals.id, ids)));
  });
}

export async function listSplits(tenantId: string, parentWorkId: string) {
  return scopedRead(async (tx) => {
    return tx.select().from(workSplits)
      .where(and(eq(workSplits.tenantId, tenantId), eq(workSplits.parentWorkId, parentWorkId)));
  });
}

/**
 * Batch resolve workId -> { workNumber, description } for a set of work ids.
 * Used by the execution module's routes to enrich its progress/issues read
 * models with the human-readable work number WITHOUT a cross-module SQL JOIN
 * (CLAUDE.md rule 4): the proposal module owns work_proposals, so it exposes
 * this in-process read and the execution route stitches the two results
 * together in application code — the same pattern the close route already
 * uses with getAward()/listSplits(). Returns a Map keyed by work id; ids with
 * no proposal row are simply absent.
 */
export async function getWorkHeaders(
  tenantId: string,
  workIds: string[],
): Promise<Map<string, { workNumber: string; description: string }>> {
  const unique = Array.from(new Set(workIds.filter((id) => id)));
  if (unique.length === 0) return new Map();
  return scopedRead(async (tx) => {
    const rows = await tx
      .select({
        id: workProposals.id,
        workNumber: workProposals.workNumber,
        description: workProposals.description,
      })
      .from(workProposals)
      .where(and(eq(workProposals.tenantId, tenantId), inArray(workProposals.id, unique)));
    return new Map(rows.map((r) => [r.id, { workNumber: r.workNumber, description: r.description }]));
  });
}

/** Single-work header — the detail page's work number + description (GAP-WORKS-EXECUTION-WORKID-01). */
export async function getWorkHeader(
  tenantId: string,
  workId: string,
): Promise<{ workNumber: string; description: string } | null> {
  const map = await getWorkHeaders(tenantId, [workId]);
  return map.get(workId) ?? null;
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

export async function updateProposal(
  tenantId: string,
  id: string,
  patch: Record<string, unknown>,
  updatedBy: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(workProposals)
      .set({ ...(patch as Partial<typeof workProposals.$inferInsert>), updatedAt: new Date(), updatedBy })
      .where(and(eq(workProposals.id, id), eq(workProposals.tenantId, tenantId)));
  });
  await cache.invalidate(`works:${tenantId}:proposal:${id}`);
}
