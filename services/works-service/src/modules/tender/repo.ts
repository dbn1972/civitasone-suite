import { eq, and, desc, inArray, count, sql } from "drizzle-orm";
import { unionAll } from "drizzle-orm/pg-core";
import { workProposals } from "../proposal/schema.js";
import { scopedRead } from "../../shared/db.js";
import { tenders, quotations, awards, preTenders } from "./schema.js";
import { tenderTypes } from "../masters/schema.js";

/** GAP-WORKS-TENDERS-NEW-06: a pre-tender reference number is unique per tenant. */
export async function preTenderReferenceExists(tenantId: string, referenceNumber: string): Promise<boolean> {
  return scopedRead(async (tx) => {
    const rows = await tx.select({ id: preTenders.id }).from(preTenders)
      .where(and(eq(preTenders.tenantId, tenantId), eq(preTenders.referenceNumber, referenceNumber)))
      .limit(1);
    return rows.length > 0;
  });
}

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

type ReadTx = Parameters<Parameters<typeof scopedRead>[0]>[0];

/**
 * Tender register rows: works.tenders UNION ALL works.pre_tenders.
 *
 * works.tenders has no producer (works.tender.create is declared in topics.ts but never wired - see
 * tenderOrPreTenderExists above), so the pre-tenders created through POST /v1/works/tenders/pre-tender are the
 * tenders that actually exist. The register therefore lists both; the FE detail page, quotations and awards already
 * accept either id. A pre-tender carries amount / authority / class as optional columns (null until populated) and has no remarks (null) and carries its own
 * status, which the FE status label prefers. Both branches are tenant-scoped.
 */
function tenderRegisterRows(tenantId: string, id?: string) {
  const fromTenders = (tx: ReadTx) => tx
    .select({
      id: tenders.id,
      tenantId: tenders.tenantId,
      workId: tenders.workId,
      tenderTypeId: tenders.tenderTypeId,
      tenderAmountMinor: sql<bigint | null>`${tenders.tenderAmountMinor}`.mapWith(tenders.tenderAmountMinor).as("tender_amount_minor"),
      openingDate: tenders.openingDate,
      approvingAuthorityId: tenders.approvingAuthorityId,
      contractorClassId: tenders.contractorClassId,
      remarks: tenders.remarks,
      status: sql<string>`NULL::varchar`.as("status"),
      createdAt: tenders.createdAt,
      workNumber: workProposals.workNumber,
    })
    .from(tenders)
    .leftJoin(workProposals, eq(workProposals.id, tenders.workId))
    .where(id ? and(eq(tenders.tenantId, tenantId), eq(tenders.id, id)) : eq(tenders.tenantId, tenantId));
  const fromPre = (tx: ReadTx) => tx
    .select({
      id: preTenders.id,
      tenantId: preTenders.tenantId,
      workId: preTenders.workId,
      tenderTypeId: preTenders.tenderTypeId,
      tenderAmountMinor: sql<bigint | null>`${preTenders.tenderAmountMinor}`.mapWith(preTenders.tenderAmountMinor).as("tender_amount_minor"),
      openingDate: preTenders.openingDate,
      approvingAuthorityId: preTenders.approvingAuthorityId,
      contractorClassId: preTenders.contractorClassId,
      remarks: sql<string | null>`NULL::varchar`.as("remarks"),
      status: preTenders.status,
      createdAt: preTenders.createdAt,
      workNumber: workProposals.workNumber,
    })
    .from(preTenders)
    .leftJoin(workProposals, eq(workProposals.id, preTenders.workId))
    .where(id ? and(eq(preTenders.tenantId, tenantId), eq(preTenders.id, id)) : eq(preTenders.tenantId, tenantId));
  return { fromTenders, fromPre };
}

/** Tenant-wide tender register (tenders + pre-tenders), newest first - backs the FE tenders list page. */
export async function listTenders(tenantId: string, page: number, pageSize: number) {
  return scopedRead(async (tx) => {
    const { fromTenders, fromPre } = tenderRegisterRows(tenantId);
    return unionAll(fromTenders(tx), fromPre(tx))
      .orderBy(desc(sql`created_at`), sql`id`)
      .limit(pageSize)
      .offset((page - 1) * pageSize);
  });
}

/**
 * GAP-WORKS-TENDERS-DETAIL-03: a single tender read by id, so the detail page
 * can resolve a tender directly instead of scanning the capped list. Resolves
 * a tenders row first, else a pre-tender (the list now surfaces both, so every
 * listed id must open). Same shape as listTenders. Null when the id does not
 * exist in this tenant.
 */
export async function getTenderById(tenantId: string, id: string) {
  return scopedRead(async (tx) => {
    const { fromTenders, fromPre } = tenderRegisterRows(tenantId, id);
    const t = await fromTenders(tx).limit(1);
    if (t[0]) return t[0];
    const p = await fromPre(tx).limit(1);
    return p[0] ?? null;
  });
}

/**
 * GAP-WORKS-TENDERS-06: exact tenant tender count (tenders + pre-tenders), so the list meta can report
 * a real total (not data.length, which caps at the page size).
 */
export async function countTenders(tenantId: string): Promise<number> {
  return scopedRead(async (tx) => {
    const [a] = await tx.select({ value: count() }).from(tenders).where(eq(tenders.tenantId, tenantId));
    const [b] = await tx.select({ value: count() }).from(preTenders).where(eq(preTenders.tenantId, tenantId));
    return Number(a?.value ?? 0) + Number(b?.value ?? 0);
  });
}

/** D4c #40: an ACTIVE tender-type master of this tenant (uncached: validation must see a just-deactivated type). */
export async function getActiveTenderType(tenantId: string, id: string) {
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(tenderTypes)
      .where(and(eq(tenderTypes.tenantId, tenantId), eq(tenderTypes.id, id), eq(tenderTypes.active, true)))
      .limit(1);
    return rows[0] ?? null;
  });
}

/**
 * D4c #45: the work a tender (or pre-tender) is for and that work's estimated cost - the figure every quotation's
 * deviation is measured against. Null when the tender does not exist; `estimateMinor` is null when the work carries no
 * positive estimate.
 */
export async function getTenderEstimate(tenantId: string, tenderId: string): Promise<{ workId: string; estimateMinor: bigint | null } | null> {
  return scopedRead(async (tx) => {
    const pre = await tx.select({ workId: preTenders.workId }).from(preTenders)
      .where(and(eq(preTenders.tenantId, tenantId), eq(preTenders.id, tenderId))).limit(1);
    let workId = pre[0]?.workId;
    if (!workId) {
      const t = await tx.select({ workId: tenders.workId }).from(tenders)
        .where(and(eq(tenders.tenantId, tenantId), eq(tenders.id, tenderId))).limit(1);
      workId = t[0]?.workId;
    }
    if (!workId) return null;
    const work = await tx.select({ cost: workProposals.estimatedCostMinor }).from(workProposals)
      .where(and(eq(workProposals.tenantId, tenantId), eq(workProposals.id, workId))).limit(1);
    const cost = work[0]?.cost ?? null;
    return { workId, estimateMinor: cost !== null && cost > 0n ? cost : null };
  });
}

/** D4c #45: the newest award of a work - how a client learns the outcome of the queued award command. */
export async function getAwardForWork(tenantId: string, workId: string) {
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(awards)
      .where(and(eq(awards.tenantId, tenantId), eq(awards.workId, workId)))
      .orderBy(desc(awards.createdAt))
      .limit(1);
    return rows[0] ?? null;
  });
}
