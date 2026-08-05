import { eq, desc, and, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { deals, type DealRow, type DealInsert, type DealView } from "./schema.js";
import { contacts } from "../contacts/schema.js";

/** Exact paise(bigint) -> "12,34,567.89" rupee string (Indian grouping). */
function rupeesFromPaise(minor: bigint): string {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const rupees = abs / 100n;
  const paise = abs % 100n;
  const digits = rupees.toString();
  let grouped: string;
  if (digits.length <= 3) {
    grouped = digits;
  } else {
    const last3 = digits.slice(-3);
    let rest = digits.slice(0, -3);
    const parts: string[] = [];
    while (rest.length > 2) {
      parts.unshift(rest.slice(-2));
      rest = rest.slice(0, -2);
    }
    if (rest.length) parts.unshift(rest);
    grouped = `${parts.join(",")},${last3}`;
  }
  const frac = paise.toString().padStart(2, "0");
  return `${neg ? "-" : ""}${grouped}.${frac}`;
}

function formatValue(minor: bigint, currency: string): string {
  const CR = 1_00_00_000_00n;
  const L = 1_00_000_00n;
  const abs = minor < 0n ? -minor : minor;
  if (abs >= CR) {
    const tenths = (minor * 10n) / CR;
    return `Rs ${(Number(tenths) / 10).toFixed(1)} Cr`;
  }
  if (abs >= L) {
    const lakhs = minor / L;
    return `Rs ${lakhs.toString()} L`;
  }
  return `${currency} ${rupeesFromPaise(minor)}`;
}

export function toView(r: DealRow, contactName?: string | null): DealView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    pipelineId: r.pipelineId,
    stageId: r.stageId,
    name: r.name,
    stage: r.stage,
    valueMinor: r.valueMinor.toString(),
    currency: r.currency,
    valueDisplay: formatValue(r.valueMinor, r.currency),
    contactId: r.contactId,
    contactName: contactName ?? null,
    ownerId: r.ownerId,
    closeDate: r.closeDate ?? null,
    closedAt: r.closedAt?.toISOString() ?? null,
    closeReason: r.closeReason ?? null,
    closedValueMinor: r.closedValueMinor?.toString() ?? null,
    probability: r.probability,
    status: r.status,
    product: r.product ?? null,
    quantity: r.quantity ?? null,
    competitors: r.competitors ?? [],
    nextStep: r.nextStep ?? null,
    expectedCloseDate: r.expectedCloseDate ?? null,
    stageEnteredAt: r.stageEnteredAt?.toISOString() ?? null,
    closeOutcome: r.closeOutcome ?? null,
    closeCompetitor: r.closeCompetitor ?? null,
    version: r.version,
  };
}

export async function findById(id: string, tenantId: string): Promise<DealView | null> {
  const rows = await scopedRead((tx) => tx.select({ deal: deals, contactName: contacts.name })
    .from(deals)
    .leftJoin(contacts, eq(deals.contactId, contacts.id))
    .where(and(eq(deals.id, id), eq(deals.tenantId, tenantId), sql`${deals.status} NOT IN ('deleted','cancelled')`))
    .limit(1));
  const row = rows[0];
  if (!row) return null;
  return toView(row.deal, row.contactName);
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<DealView[]> {
  const rows = await scopedRead((tx) => tx.select({ deal: deals, contactName: contacts.name })
    .from(deals)
    .leftJoin(contacts, eq(deals.contactId, contacts.id))
    .where(and(eq(deals.tenantId, tenantId), sql`${deals.status} NOT IN ('deleted','cancelled')`))
    .orderBy(desc(deals.updatedAt))
    .limit(limit)
    .offset(offset));
  return rows.map((r) => toView(r.deal, r.contactName));
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: DealInsert): Promise<void> {
  await tx.insert(deals).values(row);
}

export async function updateStage(tx: Writer, id: string, tenantId: string, stage: string, actorId: string, probability?: number): Promise<void> {
  const status = stage === "Won" ? "won" : stage === "Lost" ? "lost" : "active";
  const prob = stage === "Won" ? 100 : stage === "Lost" ? 0 : probability;
  const patch: Record<string, unknown> = {
    stage, status, updatedAt: new Date(), updatedBy: actorId,
    // OP-005: reset the ageing clock whenever the stage changes.
    stageEnteredAt: new Date(),
    version: sql`${deals.version} + 1`,
  };
  if (prob !== undefined) patch.probability = prob;
  await (tx as typeof db).update(deals)
    .set(patch)
    .where(and(eq(deals.id, id), eq(deals.tenantId, tenantId)));
}

export async function updateStageWithVersion(
  tx: Writer,
  id: string,
  tenantId: string,
  stage: string,
  stageId: string | undefined,
  expectedVersion: number,
  actorId: string,
  probability?: number,
): Promise<{ updated: boolean; previousStage?: string }> {
  const current = await (tx as typeof db).select({ stage: deals.stage, version: deals.version })
    .from(deals)
    .where(and(eq(deals.id, id), eq(deals.tenantId, tenantId), sql`${deals.status} NOT IN ('deleted','cancelled')`))
    .limit(1);
  if (!current[0]) return { updated: false };

  const previousStage = current[0].stage;
  const dealStatus = stage === "Won" ? "won" : stage === "Lost" ? "lost" : "active";
  const prob = stage === "Won" ? 100 : stage === "Lost" ? 0 : probability;
  const now = new Date();

  const patch: Record<string, unknown> = {
    stage,
    status: dealStatus,
    updatedAt: now,
    updatedBy: actorId,
    // OP-005: stamp entry into the new stage (only meaningful when it actually moves,
    // but re-stamping on a same-stage patch is harmless and keeps the write simple).
    stageEnteredAt: now,
    version: sql`${deals.version} + 1`,
  };
  if (stageId !== undefined) patch.stageId = stageId;
  if (prob !== undefined) patch.probability = prob;
  if (stage === "Won" || stage === "Lost") patch.closedAt = now;

  const result = await (tx as typeof db).update(deals)
    .set(patch)
    .where(and(
      eq(deals.id, id),
      eq(deals.tenantId, tenantId),
      eq(deals.version, expectedVersion),
      sql`${deals.status} NOT IN ('deleted','cancelled')`,
    ))
    .returning({ id: deals.id });

  return { updated: result.length > 0, previousStage };
}

export async function findAccountId(tx: Writer, dealId: string, tenantId: string): Promise<string | null> {
  const rows = await (tx as typeof db).select({ accountId: contacts.accountId })
    .from(deals)
    .leftJoin(contacts, and(eq(deals.contactId, contacts.id), eq(contacts.tenantId, deals.tenantId)))
    .where(and(eq(deals.id, dealId), eq(deals.tenantId, tenantId)))
    .limit(1);
  return rows[0]?.accountId ?? null;
}

export async function dealExists(tenantId: string, dealId: string): Promise<boolean> {
  const rows = await scopedRead((tx) => tx.select({ one: sql`1` }).from(deals)
    .where(and(eq(deals.tenantId, tenantId), eq(deals.id, dealId)))
    .limit(1));
  return rows.length > 0;
}

export async function contactExists(tenantId: string, contactId: string): Promise<boolean> {
  const rows = await scopedRead((tx) => tx.select({ one: sql`1` }).from(contacts)
    .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, contactId)))
    .limit(1));
  return rows.length > 0;
}

/** OP-003 opportunity fields editable alongside the P1-1 base fields. */
export interface DealPatch {
  valueMinor?: bigint;
  ownerId?: string | null;
  closeDate?: string | null;
  contactId?: string | null;
  product?: string | null;
  quantity?: number | null;
  competitors?: string[];
  nextStep?: string | null;
  expectedCloseDate?: string | null;
}

export async function updateDeal(
  tx: Writer,
  id: string,
  tenantId: string,
  fields: DealPatch,
  actorId: string,
): Promise<void> {
  const patch: Record<string, unknown> = { updatedAt: new Date(), updatedBy: actorId, version: sql`${deals.version} + 1` };
  if (fields.valueMinor !== undefined) patch.valueMinor = fields.valueMinor;
  if (fields.ownerId !== undefined) patch.ownerId = fields.ownerId;
  if (fields.closeDate !== undefined) patch.closeDate = fields.closeDate;
  if (fields.contactId !== undefined) patch.contactId = fields.contactId;
  if (fields.product !== undefined) patch.product = fields.product;
  if (fields.quantity !== undefined) patch.quantity = fields.quantity;
  if (fields.competitors !== undefined) patch.competitors = fields.competitors;
  if (fields.nextStep !== undefined) patch.nextStep = fields.nextStep;
  if (fields.expectedCloseDate !== undefined) patch.expectedCloseDate = fields.expectedCloseDate;
  await (tx as typeof db).update(deals)
    .set(patch)
    .where(and(eq(deals.id, id), eq(deals.tenantId, tenantId), sql`${deals.status} NOT IN ('deleted','cancelled')`));
}

export async function softDelete(tx: Writer, id: string, tenantId: string, actorId: string): Promise<void> {
  await (tx as typeof db).update(deals)
    .set({ status: "cancelled", updatedAt: new Date(), updatedBy: actorId, version: sql`${deals.version} + 1` })
    .where(and(eq(deals.id, id), eq(deals.tenantId, tenantId)));
}

/**
 * OP-003: gate-relevant snapshot of a deal for synchronous stage-progression checks.
 * Returns the deal's current field values (so the route can test mandatory fields),
 * its pipeline, current stage and version. Null when the deal is missing/closed.
 */
export interface GateSnapshot {
  id: string;
  pipelineId: string | null;
  stageId: string | null;
  stage: string;
  status: string;
  version: number;
  product: string | null;
  quantity: number | null;
  competitors: string[];
  nextStep: string | null;
  expectedCloseDate: string | null;
  closeDate: string | null;
  valueMinor: string;
  contactId: string | null;
  ownerId: string | null;
  name: string;
  currency: string;
}

export async function gateSnapshot(id: string, tenantId: string): Promise<GateSnapshot | null> {
  const rows = await scopedRead((tx) => tx.select({
    id: deals.id,
    pipelineId: deals.pipelineId,
    stageId: deals.stageId,
    stage: deals.stage,
    status: deals.status,
    version: deals.version,
    product: deals.product,
    quantity: deals.quantity,
    competitors: deals.competitors,
    nextStep: deals.nextStep,
    expectedCloseDate: deals.expectedCloseDate,
    closeDate: deals.closeDate,
    valueMinor: deals.valueMinor,
    contactId: deals.contactId,
    ownerId: deals.ownerId,
    name: deals.name,
    currency: deals.currency,
  }).from(deals)
    .where(and(eq(deals.id, id), eq(deals.tenantId, tenantId), sql`${deals.status} NOT IN ('deleted','cancelled')`))
    .limit(1));
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    pipelineId: r.pipelineId,
    stageId: r.stageId,
    stage: r.stage,
    status: r.status,
    version: r.version,
    product: r.product ?? null,
    quantity: r.quantity ?? null,
    competitors: r.competitors ?? [],
    nextStep: r.nextStep ?? null,
    expectedCloseDate: r.expectedCloseDate ?? null,
    closeDate: r.closeDate ?? null,
    valueMinor: r.valueMinor.toString(),
    contactId: r.contactId,
    ownerId: r.ownerId,
    name: r.name,
    currency: r.currency,
  };
}

/** OP-005: open deals whose days-in-stage exceeds their configured stage limit. */
export interface StageAgeingRow {
  id: string;
  name: string;
  stage: string;
  pipelineId: string | null;
  ownerId: string | null;
  valueMinor: string;
  stageEnteredAt: string | null;
  maxDays: number;
  daysInStage: number;
  daysOverLimit: number;
}

export async function stageAgeingExceeding(tenantId: string, pipelineId?: string): Promise<StageAgeingRow[]> {
  const pipeFilter = pipelineId ? sql`AND d.pipeline_id = ${pipelineId}` : sql``;
  const rows = await scopedRead(async (tx) => tx.execute(sql`
    SELECT d.id, d.name, d.stage, d.pipeline_id AS "pipelineId", d.owner_id AS "ownerId",
           d.value_minor::text AS "valueMinor",
           d.stage_entered_at AS "stageEnteredAt",
           sl.max_days AS "maxDays",
           FLOOR(EXTRACT(EPOCH FROM (now() - d.stage_entered_at)) / 86400)::int AS "daysInStage",
           (FLOOR(EXTRACT(EPOCH FROM (now() - d.stage_entered_at)) / 86400)::int - sl.max_days) AS "daysOverLimit"
    FROM crm.deals d
    JOIN crm.stage_limits sl
      ON sl.tenant_id = d.tenant_id
     AND sl.stage = d.stage
     AND sl.enabled = true
     AND (sl.pipeline_id = d.pipeline_id OR sl.pipeline_id IS NULL)
    WHERE d.tenant_id = ${tenantId}
      AND d.status NOT IN ('deleted','cancelled')
      AND d.close_outcome IS NULL
      AND d.stage NOT IN ('Won','Lost')
      AND d.stage_entered_at IS NOT NULL
      AND FLOOR(EXTRACT(EPOCH FROM (now() - d.stage_entered_at)) / 86400)::int > sl.max_days
      ${pipeFilter}
    ORDER BY "daysOverLimit" DESC
  `)) as unknown as StageAgeingRow[];
  return rows;
}

/** OP-004: deals grouped for a kanban board — one bucket per stage. */
export interface KanbanCard {
  id: string;
  name: string;
  stage: string;
  ownerId: string | null;
  valueMinor: string;
  probability: number;
  contactId: string | null;
}

export async function kanbanCards(tenantId: string, pipelineId?: string): Promise<KanbanCard[]> {
  const pipeFilter = pipelineId ? sql`AND pipeline_id = ${pipelineId}` : sql``;
  const rows = await scopedRead(async (tx) => tx.execute(sql`
    SELECT id, name, stage, owner_id AS "ownerId", value_minor::text AS "valueMinor",
           probability, contact_id AS "contactId"
    FROM crm.deals
    WHERE tenant_id = ${tenantId}
      AND status NOT IN ('deleted','cancelled')
      ${pipeFilter}
    ORDER BY stage, updated_at DESC
  `)) as unknown as KanbanCard[];
  return rows;
}

/** OP-004: count + summed value per stage for a funnel chart. */
export interface FunnelBucket {
  stage: string;
  count: number;
  totalValueMinor: string;
}

export async function funnelBuckets(tenantId: string, pipelineId?: string): Promise<FunnelBucket[]> {
  const pipeFilter = pipelineId ? sql`AND pipeline_id = ${pipelineId}` : sql``;
  const rows = await scopedRead(async (tx) => tx.execute(sql`
    SELECT stage, count(*)::int AS count, COALESCE(SUM(value_minor),0)::text AS "totalValueMinor"
    FROM crm.deals
    WHERE tenant_id = ${tenantId}
      AND status NOT IN ('deleted','cancelled')
      ${pipeFilter}
    GROUP BY stage
    ORDER BY stage
  `)) as unknown as FunnelBucket[];
  return rows;
}
