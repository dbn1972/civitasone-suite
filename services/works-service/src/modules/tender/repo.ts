import { eq, and, desc, inArray, count } from "drizzle-orm";
import { workProposals } from "../proposal/schema.js";
import { scopedRead } from "../../shared/db.js";
import { tenders, quotations, awards, preTenders } from "./schema.js";

export async function hasTenderForWork(tenantId: string, workId: string): Promise<boolean> {
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(tenders)
      .where(and(eq(tenders.tenantId, tenantId), eq(tenders.workId, workId)))
      .limit(1);
    return rows.length > 0;
  });
}

/** BR-015 input: "tender details exist" also covers a pre-tender — the
 * `works.tenders` table has no producer yet (see tenderOrPreTenderExists),
 * so pre_tenders is the entity that is actually populated in practice. */
export async function hasPreTenderForWork(tenantId: string, workId: string): Promise<boolean> {
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(preTenders)
      .where(and(eq(preTenders.tenantId, tenantId), eq(preTenders.workId, workId)))
      .limit(1);
    return rows.length > 0;
  });
}

/**
 * Bug fix (works-billing-integrity #4): FK check for a quotation's tenderId.
 * `works.tenders` currently has no command/consumer that ever populates it
 * (works.tender.create and works.pre_tender.finalize are declared in
 * topics.ts but neither has a producer nor a consumer wired up — a
 * pre-existing gap beyond this fix's scope), so in practice the only
 * populated "tender-like" entity a quotation can legitimately reference is
 * pre_tenders. Checking both tables keeps this correct if/when `tenders`
 * ever gains a real producer.
 */
export async function tenderOrPreTenderExists(tenantId: string, tenderId: string): Promise<boolean> {
  return scopedRead(async (tx) => {
    const tenderRows = await tx.select({ id: tenders.id }).from(tenders)
      .where(and(eq(tenders.tenantId, tenantId), eq(tenders.id, tenderId)))
      .limit(1);
    if (tenderRows.length > 0) return true;
    const preTenderRows = await tx.select({ id: preTenders.id }).from(preTenders)
      .where(and(eq(preTenders.tenantId, tenantId), eq(preTenders.id, tenderId)))
      .limit(1);
    return preTenderRows.length > 0;
  });
}

export async function getAward(tenantId: string, workId: string) {
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(awards)
      .where(and(eq(awards.tenantId, tenantId), eq(awards.workId, workId)));
    return rows[0] ?? null;
  });
}

export async function listQuotations(tenantId: string, tenderId: string) {
  return scopedRead(async (tx) => {
    return tx.select().from(quotations)
      .where(and(eq(quotations.tenantId, tenantId), eq(quotations.tenderId, tenderId)));
  });
}

export async function getAwardById(tenantId: string, id: string) {
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(awards)
      .where(and(eq(awards.tenantId, tenantId), eq(awards.id, id)))
      .limit(1);
    return rows[0] ?? null;
  });
}

/**
 * GAP-WORKS-CLOSURE-02 (DECISION — safe default): map each workId to its
 * agreement number ONLY when that work has EXACTLY ONE distinct finalized
 * (dao/do_finalized) award. A work can carry more than one award
 * (re-tender/revision), so "the" agreement is genuinely ambiguous; rather
 * than guess (latest? first?), an ambiguous or absent case maps to null (the
 * closure register then shows "—") so a contract is never misidentified.
 * Lives in the tender module because `awards` is this module's table — the
 * execution route composes it with its own closures (no cross-module schema
 * import in the execution repo).
 */
export async function finalizedAgreementByWorkIds(
  tenantId: string,
  workIds: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (workIds.length === 0) return result;
  const uniqueIds = Array.from(new Set(workIds));
  const rows = await scopedRead(async (tx) => {
    return tx
      .select({ workId: awards.workId, agreementNumber: awards.agreementNumber, status: awards.status })
      .from(awards)
      .where(and(eq(awards.tenantId, tenantId), inArray(awards.workId, uniqueIds)));
  });
  const numbersByWork = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.status !== "dao_finalized" && r.status !== "do_finalized") continue;
    if (!r.agreementNumber) continue;
    const set = numbersByWork.get(r.workId) ?? new Set<string>();
    set.add(r.agreementNumber);
    numbersByWork.set(r.workId, set);
  }
  for (const [wid, set] of numbersByWork) {
    if (set.size === 1) result.set(wid, Array.from(set)[0]!);
  }
  return result;
}

/** Tenant-wide tender register (post pre-tender stage), newest first — backs the FE tenders list page. */
export async function listTenders(tenantId: string, page: number, pageSize: number) {
  return scopedRead(async (tx) => {
    return tx
      .select({
        id: tenders.id,
        tenantId: tenders.tenantId,
        workId: tenders.workId,
        tenderTypeId: tenders.tenderTypeId,
        tenderAmountMinor: tenders.tenderAmountMinor,
        openingDate: tenders.openingDate,
        approvingAuthorityId: tenders.approvingAuthorityId,
        contractorClassId: tenders.contractorClassId,
        remarks: tenders.remarks,
        createdAt: tenders.createdAt,
        workNumber: workProposals.workNumber,
      })
      .from(tenders)
      .leftJoin(workProposals, eq(workProposals.id, tenders.workId))
      .where(eq(tenders.tenantId, tenantId))
      .orderBy(desc(tenders.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
  });
}

/**
 * GAP-WORKS-TENDERS-DETAIL-03: a single tender read by id, so the detail page
 * can resolve a tender directly instead of scanning the capped list (tenders
 * ranked beyond the list cap were previously unreachable by URL). Same
 * leftJoin to work_proposals as listTenders so the shape matches. Null when
 * the id does not exist in this tenant.
 */
export async function getTenderById(tenantId: string, id: string) {
  return scopedRead(async (tx) => {
    const rows = await tx
      .select({
        id: tenders.id,
        tenantId: tenders.tenantId,
        workId: tenders.workId,
        tenderTypeId: tenders.tenderTypeId,
        tenderAmountMinor: tenders.tenderAmountMinor,
        openingDate: tenders.openingDate,
        approvingAuthorityId: tenders.approvingAuthorityId,
        contractorClassId: tenders.contractorClassId,
        remarks: tenders.remarks,
        createdAt: tenders.createdAt,
        workNumber: workProposals.workNumber,
      })
      .from(tenders)
      .leftJoin(workProposals, eq(workProposals.id, tenders.workId))
      .where(and(eq(tenders.tenantId, tenantId), eq(tenders.id, id)))
      .limit(1);
    return rows[0] ?? null;
  });
}

/**
 * GAP-WORKS-TENDERS-06: exact tenant tender count, so the list meta can report
 * a real total (not `data.length`, which caps at the page size and makes the
 * list and the stat cards undercount in large tenants).
 */
export async function countTenders(tenantId: string): Promise<number> {
  return scopedRead(async (tx) => {
    const rows = await tx
      .select({ value: count() })
      .from(tenders)
      .where(eq(tenders.tenantId, tenantId));
    return Number(rows[0]?.value ?? 0);
  });
}
