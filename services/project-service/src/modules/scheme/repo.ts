import { eq, and, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { projectProjects } from "../project/schema.js";
import {
  projectSchemes, projectSchemeComponents, projectFundReleases,
  type SchemeRow, type SchemeInsert, type ComponentRow, type ComponentInsert,
  type FundReleaseRow, type FundReleaseInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findSchemeById(id: string, tenantId: string): Promise<SchemeRow | null> {
  const rows = await db.select().from(projectSchemes)
    .where(and(eq(projectSchemes.id, id), eq(projectSchemes.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findSchemeByIdTx(tx: Writer, id: string, tenantId: string): Promise<SchemeRow | null> {
  const rows = await (tx as typeof db).select().from(projectSchemes)
    .where(and(eq(projectSchemes.id, id), eq(projectSchemes.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function insertScheme(tx: Writer, row: SchemeInsert): Promise<void> {
  await tx.insert(projectSchemes).values(row);
}

export async function findComponentByIdTx(tx: Writer, id: string, tenantId: string): Promise<ComponentRow | null> {
  const rows = await (tx as typeof db).select().from(projectSchemeComponents)
    .where(and(eq(projectSchemeComponents.id, id), eq(projectSchemeComponents.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

// P1-4: pessimistic row lock for the allocation read-modify-write inside the tx.
export async function lockComponentByIdTx(tx: Writer, id: string, tenantId: string): Promise<ComponentRow | null> {
  const rows = await (tx as typeof db).select().from(projectSchemeComponents)
    .where(and(eq(projectSchemeComponents.id, id), eq(projectSchemeComponents.tenantId, tenantId)))
    .limit(1).for("update");
  return rows[0] ?? null;
}

export async function insertComponent(tx: Writer, row: ComponentInsert): Promise<void> {
  await tx.insert(projectSchemeComponents).values(row);
}

export async function listComponentsByScheme(schemeId: string, tenantId: string): Promise<ComponentRow[]> {
  return db.select().from(projectSchemeComponents)
    .where(and(eq(projectSchemeComponents.schemeId, schemeId), eq(projectSchemeComponents.tenantId, tenantId)));
}

export async function updateComponentReleasedTx(tx: Writer, id: string, delta: bigint, currentVersion: number): Promise<void> {
  const existing = await (tx as typeof db).select().from(projectSchemeComponents).where(eq(projectSchemeComponents.id, id)).limit(1);
  const row = existing[0];
  if (!row) throw new Error(`component ${id} not found`);
  const newReleased = (row.releasedMinor ?? 0n) + delta;
  await tx.update(projectSchemeComponents).set({ releasedMinor: newReleased, updatedAt: new Date(), version: currentVersion + 1 })
    .where(eq(projectSchemeComponents.id, id));
}

// P0-5 rollups: atomic bigint increments (no Number() on paise).
export async function incrementComponentReleasedTx(tx: Writer, id: string, delta: bigint): Promise<void> {
  await tx.update(projectSchemeComponents)
    .set({
      releasedMinor: sql`${projectSchemeComponents.releasedMinor} + ${delta}`,
      updatedAt: new Date(),
      version: sql`${projectSchemeComponents.version} + 1`,
    })
    .where(eq(projectSchemeComponents.id, id));
}

export async function incrementComponentUtilisedTx(tx: Writer, id: string, delta: bigint): Promise<void> {
  await tx.update(projectSchemeComponents)
    .set({
      utilisedMinor: sql`${projectSchemeComponents.utilisedMinor} + ${delta}`,
      updatedAt: new Date(),
      version: sql`${projectSchemeComponents.version} + 1`,
    })
    .where(eq(projectSchemeComponents.id, id));
}

export async function incrementSchemeReleasedTx(tx: Writer, id: string, delta: bigint): Promise<void> {
  await tx.update(projectSchemes)
    .set({
      releasedMinor: sql`${projectSchemes.releasedMinor} + ${delta}`,
      updatedAt: new Date(),
      version: sql`${projectSchemes.version} + 1`,
    })
    .where(eq(projectSchemes.id, id));
}

export async function incrementSchemeUtilisedTx(tx: Writer, id: string, delta: bigint): Promise<void> {
  await tx.update(projectSchemes)
    .set({
      utilisedMinor: sql`${projectSchemes.utilisedMinor} + ${delta}`,
      updatedAt: new Date(),
      version: sql`${projectSchemes.version} + 1`,
    })
    .where(eq(projectSchemes.id, id));
}

export async function findFundReleaseByIdTx(tx: Writer, id: string, tenantId: string): Promise<FundReleaseRow | null> {
  const rows = await (tx as typeof db).select().from(projectFundReleases)
    .where(and(eq(projectFundReleases.id, id), eq(projectFundReleases.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function insertFundRelease(tx: Writer, row: FundReleaseInsert): Promise<void> {
  await tx.insert(projectFundReleases).values(row);
}

export async function updateFundReleaseTx(tx: Writer, id: string, patch: Partial<FundReleaseInsert>): Promise<void> {
  await tx.update(projectFundReleases).set({ ...patch, updatedAt: new Date() }).where(eq(projectFundReleases.id, id));
}

export async function listFundReleasesByScheme(schemeId: string, tenantId: string): Promise<FundReleaseRow[]> {
  return db.select().from(projectFundReleases)
    .where(and(eq(projectFundReleases.schemeId, schemeId), eq(projectFundReleases.tenantId, tenantId)));
}

export async function listFundReleasesByTenant(tenantId: string, limit: number): Promise<FundReleaseRow[]> {
  return db.select().from(projectFundReleases).where(eq(projectFundReleases.tenantId, tenantId)).limit(limit);
}

export async function listSchemesByTenant(tenantId: string, limit: number): Promise<SchemeRow[]> {
  return db.select().from(projectSchemes).where(eq(projectSchemes.tenantId, tenantId)).limit(limit);
}

export async function countProjectsByScheme(schemeId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projectProjects)
    .where(eq(projectProjects.schemeId, schemeId));
  return row?.count ?? 0;
}
