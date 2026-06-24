import { eq, desc, and, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { deals, type DealRow, type DealInsert, type DealView } from "./schema.js";
import { contacts } from "../contacts/schema.js";

/** Exact paise(bigint) -> "12,34,567.89" rupee string (Indian grouping). */
function rupeesFromPaise(minor: bigint): string {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const rupees = abs / 100n;
  const paise = abs % 100n;
  // Indian digit grouping on the integer rupee part.
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
  // Thresholds in paise to keep comparisons exact (no float).
  const CR = 1_00_00_000_00n; // 1 crore rupees in paise
  const L = 1_00_000_00n;     // 1 lakh rupees in paise
  const abs = minor < 0n ? -minor : minor;
  if (abs >= CR) {
    // one decimal place of crores, computed in integer paise
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
    name: r.name,
    stage: r.stage,
    valueMinor: r.valueMinor.toString(),
    currency: r.currency,
    valueDisplay: formatValue(r.valueMinor, r.currency),
    contactId: r.contactId,
    contactName: contactName ?? null,
    ownerId: r.ownerId,
    closeDate: r.closeDate ?? null,
    probability: r.probability,
    status: r.status,
    version: r.version,
  };
}

export async function findById(id: string, tenantId: string): Promise<DealView | null> {
  const rows = await db.select({ deal: deals, contactName: contacts.name })
    .from(deals)
    .leftJoin(contacts, eq(deals.contactId, contacts.id))
    .where(and(eq(deals.id, id), eq(deals.tenantId, tenantId), sql`${deals.status} <> 'deleted'`))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return toView(row.deal, row.contactName);
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<DealView[]> {
  const rows = await db.select({ deal: deals, contactName: contacts.name })
    .from(deals)
    .leftJoin(contacts, eq(deals.contactId, contacts.id))
    .where(and(eq(deals.tenantId, tenantId), sql`${deals.status} <> 'deleted'`))
    .orderBy(desc(deals.updatedAt))
    .limit(limit)
    .offset(offset);
  return rows.map((r) => toView(r.deal, r.contactName));
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: DealInsert): Promise<void> {
  await tx.insert(deals).values(row);
}

export async function updateStage(tx: Writer, id: string, tenantId: string, stage: string, actorId: string, probability?: number): Promise<void> {
  const status = stage === "Won" ? "won" : stage === "Lost" ? "lost" : "active";
  // P1-2: persist probability. Won pins to 100, Lost to 0; otherwise honour an
  // explicit value when supplied, else leave the existing probability intact.
  const prob = stage === "Won" ? 100 : stage === "Lost" ? 0 : probability;
  const patch: Record<string, unknown> = { stage, status, updatedAt: new Date(), updatedBy: actorId };
  if (prob !== undefined) patch.probability = prob;
  await (tx as typeof db).update(deals)
    .set(patch)
    .where(and(eq(deals.id, id), eq(deals.tenantId, tenantId)));
}

/** Tenant-scoped existence check for a deal (cross-tenant FK guard). */
export async function dealExists(tenantId: string, dealId: string): Promise<boolean> {
  const rows = await db.select({ one: sql`1` }).from(deals)
    .where(and(eq(deals.tenantId, tenantId), eq(deals.id, dealId)))
    .limit(1);
  return rows.length > 0;
}

/** Tenant-scoped existence check for a contact (cross-tenant FK guard). */
export async function contactExists(tenantId: string, contactId: string): Promise<boolean> {
  const rows = await db.select({ one: sql`1` }).from(contacts)
    .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, contactId)))
    .limit(1);
  return rows.length > 0;
}

/** P1-1: patch editable deal fields (value/owner/closeDate/contactId). */
export async function updateDeal(
  tx: Writer,
  id: string,
  tenantId: string,
  fields: { valueMinor?: bigint; ownerId?: string | null; closeDate?: string | null; contactId?: string | null },
  actorId: string,
): Promise<void> {
  const patch: Record<string, unknown> = { updatedAt: new Date(), updatedBy: actorId, version: sql`${deals.version} + 1` };
  if (fields.valueMinor !== undefined) patch.valueMinor = fields.valueMinor;
  if (fields.ownerId !== undefined) patch.ownerId = fields.ownerId;
  if (fields.closeDate !== undefined) patch.closeDate = fields.closeDate;
  if (fields.contactId !== undefined) patch.contactId = fields.contactId;
  await (tx as typeof db).update(deals)
    .set(patch)
    .where(and(eq(deals.id, id), eq(deals.tenantId, tenantId), sql`${deals.status} <> 'deleted'`));
}

/** P1-1: soft-delete a deal (status='deleted'); excluded from find/list. */
export async function softDelete(tx: Writer, id: string, tenantId: string, actorId: string): Promise<void> {
  await (tx as typeof db).update(deals)
    .set({ status: "deleted", updatedAt: new Date(), updatedBy: actorId, version: sql`${deals.version} + 1` })
    .where(and(eq(deals.id, id), eq(deals.tenantId, tenantId)));
}
