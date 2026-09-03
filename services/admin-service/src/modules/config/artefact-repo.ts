/**
 * WC-010 — DB access for configuration artefacts.
 *
 * Reads go through scopedRead() (a transaction) so the app.tenant_id GUC is set
 * and RLS is enforced on the read path too — a bare select under FORCE RLS
 * returns zero rows. Writes take the caller's transaction so the audit outbox
 * row lands atomically with the data (same pattern as central-config/repo.ts).
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import {
  configArtefacts,
  configPromotions,
  configEnvState,
  type ConfigArtefactRow,
  type ConfigArtefactInsert,
  type ConfigPromotionRow,
  type ConfigPromotionInsert,
  type ConfigEnvStateRow,
  type ConfigEnvStateInsert,
} from "./artefact-schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

// Drizzle's insert/update builders expose `.returning()` and
// `.returning({ col })`; this narrow structural type covers both without
// pulling the full builder generics into every repo signature.
type Returning<T> = { returning: (fields?: Record<string, unknown>) => Promise<T[]> };

// ── artefacts ───────────────────────────────────────────────────────────────

export async function insertArtefact(tx: Writer, row: ConfigArtefactInsert): Promise<ConfigArtefactRow> {
  const rows = await (tx.insert(configArtefacts).values(row) as unknown as Returning<ConfigArtefactRow>).returning();
  const created = rows[0];
  if (!created) throw new Error("insertArtefact: no row returned");
  return created;
}

export async function maxArtefactVersionTx(tx: Writer, tenantId: string, setKey: string): Promise<number | null> {
  const rows = await tx.select({ v: configArtefacts.artefactVersion }).from(configArtefacts)
    .where(and(eq(configArtefacts.tenantId, tenantId), eq(configArtefacts.setKey, setKey)))
    .orderBy(desc(configArtefacts.artefactVersion))
    .limit(1);
  return rows[0]?.v ?? null;
}

/**
 * Non-transactional (scopedRead) counterpart of maxArtefactVersionTx, used by
 * the snapshot route to synchronously check for a byte-identical head before
 * accepting a new version — see the ARTEFACT_UNCHANGED guard in
 * artefact-routes.ts, mirroring apply_config_0 exactly.
 */
export async function maxArtefactVersion(tenantId: string, setKey: string): Promise<number | null> {
  return scopedRead((tx) => maxArtefactVersionTx(tx, tenantId, setKey));
}

export async function listArtefacts(
  tenantId: string,
  limit: number,
  offset: number,
  setKey?: string,
): Promise<{ rows: ConfigArtefactRow[]; total: number }> {
  const where = setKey === undefined
    ? eq(configArtefacts.tenantId, tenantId)
    : and(eq(configArtefacts.tenantId, tenantId), eq(configArtefacts.setKey, setKey));
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(configArtefacts).where(where)
      .orderBy(desc(configArtefacts.artefactVersion)).limit(limit).offset(offset);
    const counted = await tx.select({ n: sql<number>`count(*)::int` }).from(configArtefacts).where(where);
    return { rows, total: counted[0]?.n ?? 0 };
  });
}

export async function findArtefactById(tenantId: string, id: string): Promise<ConfigArtefactRow | undefined> {
  const rows = await scopedRead((tx) => tx.select().from(configArtefacts)
    .where(and(eq(configArtefacts.id, id), eq(configArtefacts.tenantId, tenantId))).limit(1));
  return rows[0];
}

export async function findArtefactByVersion(
  tenantId: string,
  setKey: string,
  artefactVersion: number,
): Promise<ConfigArtefactRow | undefined> {
  const rows = await scopedRead((tx) => tx.select().from(configArtefacts)
    .where(and(
      eq(configArtefacts.tenantId, tenantId),
      eq(configArtefacts.setKey, setKey),
      eq(configArtefacts.artefactVersion, artefactVersion),
    )).limit(1));
  return rows[0];
}

export async function findArtefactByVersionTx(
  tx: Writer,
  tenantId: string,
  setKey: string,
  artefactVersion: number,
): Promise<ConfigArtefactRow | undefined> {
  const rows = await tx.select().from(configArtefacts)
    .where(and(
      eq(configArtefacts.tenantId, tenantId),
      eq(configArtefacts.setKey, setKey),
      eq(configArtefacts.artefactVersion, artefactVersion),
    )).limit(1);
  return rows[0];
}

// ── promotions ──────────────────────────────────────────────────────────────

export async function insertPromotion(tx: Writer, row: ConfigPromotionInsert): Promise<ConfigPromotionRow> {
  const rows = await (tx.insert(configPromotions).values(row) as unknown as Returning<ConfigPromotionRow>).returning();
  const created = rows[0];
  if (!created) throw new Error("insertPromotion: no row returned");
  return created;
}

export async function findPromotionByIdTx(tx: Writer, tenantId: string, id: string): Promise<ConfigPromotionRow | undefined> {
  const rows = await tx.select().from(configPromotions)
    .where(and(eq(configPromotions.id, id), eq(configPromotions.tenantId, tenantId))).limit(1);
  return rows[0];
}

/**
 * Non-transactional (scopedRead) counterpart of findPromotionByIdTx, used by
 * the approve/reject routes to synchronously check existence, pending state,
 * maker-checker separation and the optimistic lock before accepting the
 * write — mirrors apply_config_2/apply_config_3 exactly.
 */
export async function findPromotionById(tenantId: string, id: string): Promise<ConfigPromotionRow | undefined> {
  return scopedRead((tx) => findPromotionByIdTx(tx, tenantId, id));
}

export async function listPromotions(
  tenantId: string,
  limit: number,
  offset: number,
  status?: string,
): Promise<{ rows: ConfigPromotionRow[]; total: number }> {
  const where = status === undefined
    ? eq(configPromotions.tenantId, tenantId)
    : and(eq(configPromotions.tenantId, tenantId), eq(configPromotions.status, status));
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(configPromotions).where(where)
      .orderBy(desc(configPromotions.createdAt)).limit(limit).offset(offset);
    const counted = await tx.select({ n: sql<number>`count(*)::int` }).from(configPromotions).where(where);
    return { rows, total: counted[0]?.n ?? 0 };
  });
}

/**
 * Decide a promotion with an optimistic lock. Returns false when no row matched
 * the expected version — the route turns that into 409 VERSION_CONFLICT.
 */
export async function decidePromotion(
  tx: Writer,
  tenantId: string,
  id: string,
  expectedVersion: number,
  patch: Partial<ConfigPromotionInsert>,
): Promise<boolean> {
  const rows = await (tx.update(configPromotions)
    .set({ ...patch, version: expectedVersion + 1, updatedAt: new Date() })
    .where(and(
      eq(configPromotions.id, id),
      eq(configPromotions.tenantId, tenantId),
      eq(configPromotions.version, expectedVersion),
    )) as unknown as Returning<{ id: string }>).returning({ id: configPromotions.id });
  return rows.length > 0;
}

/** Artefact versions previously promoted into an environment (rollback targets). */
export async function promotedVersionsTx(
  tx: Writer,
  tenantId: string,
  setKey: string,
  environment: string,
): Promise<number[]> {
  const rows = await tx.select({ v: configPromotions.artefactVersion }).from(configPromotions)
    .where(and(
      eq(configPromotions.tenantId, tenantId),
      eq(configPromotions.setKey, setKey),
      eq(configPromotions.targetEnv, environment),
      eq(configPromotions.status, "promoted"),
    ));
  return rows.map((r) => r.v);
}

/**
 * Non-transactional (scopedRead) counterpart of promotedVersionsTx, used by
 * the rollback route to synchronously check that the target version was
 * previously promoted to this environment — mirrors apply_config_4 exactly.
 */
export async function promotedVersions(
  tenantId: string,
  setKey: string,
  environment: string,
): Promise<number[]> {
  return scopedRead((tx) => promotedVersionsTx(tx, tenantId, setKey, environment));
}

// ── environment state ───────────────────────────────────────────────────────

export async function findEnvStateTx(
  tx: Writer,
  tenantId: string,
  setKey: string,
  environment: string,
): Promise<ConfigEnvStateRow | undefined> {
  const rows = await tx.select().from(configEnvState)
    .where(and(
      eq(configEnvState.tenantId, tenantId),
      eq(configEnvState.setKey, setKey),
      eq(configEnvState.environment, environment),
    )).limit(1);
  return rows[0];
}

/**
 * Non-transactional (scopedRead) counterpart of findEnvStateTx, used by the
 * rollback route to synchronously check existence and the optimistic lock
 * before accepting the write — mirrors apply_config_4 exactly.
 */
export async function findEnvState(
  tenantId: string,
  setKey: string,
  environment: string,
): Promise<ConfigEnvStateRow | undefined> {
  return scopedRead((tx) => findEnvStateTx(tx, tenantId, setKey, environment));
}

export async function insertEnvState(tx: Writer, row: ConfigEnvStateInsert): Promise<ConfigEnvStateRow> {
  const rows = await (tx.insert(configEnvState).values(row) as unknown as Returning<ConfigEnvStateRow>).returning();
  const created = rows[0];
  if (!created) throw new Error("insertEnvState: no row returned");
  return created;
}

/**
 * Move an environment to a different artefact version under an optimistic lock.
 * Returns false when the expected version no longer matches → 409.
 */
export async function updateEnvState(
  tx: Writer,
  tenantId: string,
  id: string,
  expectedVersion: number,
  patch: { artefactId: string; artefactVersion: number; promotedBy: string; updatedBy: string },
): Promise<boolean> {
  const rows = await (tx.update(configEnvState)
    .set({ ...patch, promotedAt: new Date(), updatedAt: new Date(), version: expectedVersion + 1 })
    .where(and(
      eq(configEnvState.id, id),
      eq(configEnvState.tenantId, tenantId),
      eq(configEnvState.version, expectedVersion),
    )) as unknown as Returning<{ id: string }>).returning({ id: configEnvState.id });
  return rows.length > 0;
}

export async function listEnvState(
  tenantId: string,
  limit: number,
  offset: number,
): Promise<{ rows: ConfigEnvStateRow[]; total: number }> {
  const where = eq(configEnvState.tenantId, tenantId);
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(configEnvState).where(where)
      .orderBy(configEnvState.setKey, configEnvState.environment).limit(limit).offset(offset);
    const counted = await tx.select({ n: sql<number>`count(*)::int` }).from(configEnvState).where(where);
    return { rows, total: counted[0]?.n ?? 0 };
  });
}
