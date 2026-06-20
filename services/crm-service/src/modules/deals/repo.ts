import { eq, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { deals, type DealRow, type DealInsert, type DealView } from "./schema.js";

function formatValue(minor: bigint, currency: string): string {
  const major = Number(minor) / 100;
  if (major >= 1_00_00_000) return `Rs ${(major / 1_00_00_000).toFixed(1)} Cr`;
  if (major >= 1_00_000) return `Rs ${(major / 1_00_000).toFixed(0)} L`;
  return `${currency} ${major.toLocaleString("en-IN")}`;
}

export function toView(r: DealRow): DealView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    stage: r.stage,
    valueMinor: r.valueMinor.toString(),
    currency: r.currency,
    valueDisplay: formatValue(r.valueMinor, r.currency),
    status: r.status,
    version: r.version,
  };
}

export async function findById(id: string, tenantId: string): Promise<DealView | null> {
  const rows = await db.select().from(deals).where(eq(deals.id, id)).limit(1);
  const row = rows[0];
  if (!row || row.tenantId !== tenantId) return null;
  return toView(row);
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<DealView[]> {
  const rows = await db.select().from(deals)
    .where(eq(deals.tenantId, tenantId))
    .orderBy(desc(deals.updatedAt))
    .limit(limit)
    .offset(offset);
  return rows.map(toView);
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: DealInsert): Promise<void> {
  await tx.insert(deals).values(row);
}
