/**
 * plans repo — Drizzle queries against `plans.*` ONLY (L2).
 * READS are used by the query path (always behind the cache).
 * WRITES are used ONLY by the consumer, inside the outbox transaction.
 */
import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { plans, type PlanRow, type PlanInsert } from "./schema.js";

export interface PlanView {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  edition: "small_office" | "psu" | "govt_dept";
  maxUsers: number;
  maxStorageGb: number;
  enabledModules: string[];
  priceMinor: bigint;
  billingCycle: "monthly" | "quarterly" | "annual";
  features: Record<string, unknown>;
  version: number;
}

function toView(r: PlanRow): PlanView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    code: r.code,
    name: r.name,
    edition: r.edition,
    maxUsers: r.maxUsers,
    maxStorageGb: r.maxStorageGb,
    enabledModules: r.enabledModules,
    priceMinor: r.priceMinor,
    billingCycle: r.billingCycle,
    features: r.features,
    version: r.version,
  };
}

// ── reads (query path) ───────────────────────────────────────────────
export async function findById(id: string): Promise<PlanView | null> {
  const rows = await db.select().from(plans).where(eq(plans.id, id)).limit(1);
  return rows[0] ? toView(rows[0]) : null;
}

export async function findByCode(code: string): Promise<PlanView | null> {
  const rows = await db.select().from(plans).where(eq(plans.code, code)).limit(1);
  return rows[0] ? toView(rows[0]) : null;
}

export async function findAll(): Promise<PlanView[]> {
  const rows = await db.select().from(plans);
  return rows.map(toView);
}

// ── writes (consumer only, within a tx) ──────────────────────────────
export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: PlanInsert): Promise<void> {
  await tx.insert(plans).values(row);
}

export async function update(tx: Writer, id: string, patch: Partial<PlanInsert>): Promise<void> {
  await tx.update(plans).set({ ...patch, updatedAt: new Date() }).where(eq(plans.id, id));
}

export async function findByIdTx(tx: Writer, id: string): Promise<PlanView | null> {
  const rows = await tx.select().from(plans).where(eq(plans.id, id)).limit(1);
  return rows[0] ? toView(rows[0]) : null;
}
