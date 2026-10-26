import { tenantTransaction } from "@civitasone/db";
import { cache } from "../../shared/infra.js";
import { db } from "../../shared/db.js";
import { assessees } from "./schema.js";
import { eq, and, or, ilike, sql } from "drizzle-orm";
import { SERVICE } from "../../topics.js";

export async function findAssessee(tenantId: string, id: string) {
  const rows = await cache.getOrLoad(`${SERVICE}:${tenantId}:assessee:${id}`, async () => {
    return tenantTransaction(db, tenantId, async (tx) => {
      const t = tx as typeof db;
      return t
        .select()
        .from(assessees)
        .where(and(eq(assessees.tenantId, tenantId), eq(assessees.id, id)));
    });
  });
  return rows?.[0] ?? null;
}

/**
 * Synchronous duplicate pre-check for POST /assessees (GAP-REVENUE-ASSESSEES-03).
 * Uncached on purpose: the create command is async (202), so a stale cache entry
 * must never let a duplicate slip past the guard. The DB unique index
 * uq_assessees_tenant_identifier remains the authoritative backstop.
 */
export async function findAssesseeByIdentifier(tenantId: string, identifierNo: string) {
  const rows = await tenantTransaction(db, tenantId, async (tx) => {
    const t = tx as typeof db;
    return t
      .select({ id: assessees.id })
      .from(assessees)
      .where(and(eq(assessees.tenantId, tenantId), eq(assessees.identifierNo, identifierNo)))
      .limit(1);
  });
  return rows?.[0] ?? null;
}

/** Escape LIKE wildcards so a search term is matched literally. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Server-side search (GAP-REVENUE-ASSESSEES-04): case-insensitive substring match
 * on owner name or identifier, with LIMIT/OFFSET and an exact total pushed into
 * SQL so a register larger than the page/picker limit is never silently truncated.
 */
async function searchAssessees(tenantId: string, q: string, pagination: { limit: number; offset: number }) {
  const pattern = likePattern(q);
  return tenantTransaction(db, tenantId, async (tx) => {
    const t = tx as typeof db;
    const where = and(
      eq(assessees.tenantId, tenantId),
      or(ilike(assessees.ownerName, pattern), ilike(assessees.identifierNo, pattern)),
    );
    const data = await t
      .select()
      .from(assessees)
      .where(where)
      .orderBy(assessees.ownerName, assessees.id)
      .limit(pagination.limit)
      .offset(pagination.offset);
    const counted = await t.select({ n: sql<number>`count(*)::int` }).from(assessees).where(where);
    return { data: data ?? [], total: Number(counted?.[0]?.n ?? 0) };
  });
}

type AssesseeSummary = { total: number; property: number; waterConnection: number; other: number; active: number };

function summarise(all: Array<{ assesseeType: string; isActive: boolean }>): AssesseeSummary {
  const property = all.filter((a) => a.assesseeType === "property").length;
  const waterConnection = all.filter((a) => a.assesseeType === "water_connection").length;
  return {
    total: all.length,
    property,
    waterConnection,
    other: all.length - property - waterConnection,
    active: all.filter((a) => a.isActive).length,
  };
}

export async function listAssessees(
  tenantId: string,
  pagination: { limit: number; offset: number },
  q?: string,
) {
  const rows = await cache.getOrLoad(`${SERVICE}:${tenantId}:assessees`, async () => {
    return tenantTransaction(db, tenantId, async (tx) => {
      const t = tx as typeof db;
      // ORDER BY needed for the same reason as trade-license's listing (see
      // that module's repo.ts): pagination slices this result in-memory, so
      // without a deterministic order the page boundaries aren't stable.
      // ownerName mirrors the mobile/web lookup-by-name UI; `id` breaks ties.
      return t
        .select()
        .from(assessees)
        .where(eq(assessees.tenantId, tenantId))
        .orderBy(assessees.ownerName, assessees.id);
    });
  });
  const all = rows ?? [];
  // Tenant-wide summary (independent of q/page) so the register's stat tiles stay
  // correct when the table is server-paginated (GAP-REVENUE-ASSESSEES-04).
  const summary = summarise(all);
  const page = Math.floor(pagination.offset / pagination.limit) + 1;
  if (q) {
    const found = await searchAssessees(tenantId, q, pagination);
    return { data: found.data, meta: { page, pageSize: pagination.limit, total: found.total, summary } };
  }
  const total = all.length;
  const data = all.slice(pagination.offset, pagination.offset + pagination.limit);
  return { data, meta: { page, pageSize: pagination.limit, total, summary } };
}
