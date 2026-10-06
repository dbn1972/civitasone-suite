/**
 * CR-MKT-05 — experiment reads/writes.
 */
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { db, readScoped } from "../../shared/db.js";
import {
  experiments,
  experimentVariants,
  experimentEvents,
  type ExperimentInsert,
  type ExperimentVariantInsert,
  type ExperimentEventInsert,
  type ExperimentRow,
  type ExperimentVariantRow,
  type ExperimentEventRow,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertExperiment(tx: Writer, row: ExperimentInsert): Promise<void> {
  await tx.insert(experiments).values(row);
}

export async function insertVariants(tx: Writer, rows: ExperimentVariantInsert[]): Promise<void> {
  if (rows.length === 0) return;
  await tx.insert(experimentVariants).values(rows);
}

export async function insertEvent(tx: Writer, row: ExperimentEventInsert): Promise<void> {
  await tx.insert(experimentEvents).values(row);
}

export async function findExperimentInTx(
  tx: Writer, tenantId: string, id: string,
): Promise<ExperimentRow | null> {
  const rows = await tx.select().from(experiments)
    .where(and(eq(experiments.tenantId, tenantId), eq(experiments.id, id))).limit(1);
  return rows[0] ?? null;
}

export async function findVariantInTx(
  tx: Writer, tenantId: string, experimentId: string, variantId: string,
): Promise<ExperimentVariantRow | null> {
  const rows = await tx.select().from(experimentVariants)
    .where(and(
      eq(experimentVariants.tenantId, tenantId),
      eq(experimentVariants.experimentId, experimentId),
      eq(experimentVariants.id, variantId),
    )).limit(1);
  return rows[0] ?? null;
}

export async function listVariantsInTx(
  tx: Writer, tenantId: string, experimentId: string,
): Promise<ExperimentVariantRow[]> {
  return tx.select().from(experimentVariants)
    .where(and(
      eq(experimentVariants.tenantId, tenantId),
      eq(experimentVariants.experimentId, experimentId),
    ));
}

export async function listEventsInTx(
  tx: Writer, tenantId: string, experimentId: string,
): Promise<ExperimentEventRow[]> {
  return tx.select().from(experimentEvents)
    .where(and(
      eq(experimentEvents.tenantId, tenantId),
      eq(experimentEvents.experimentId, experimentId),
    ));
}

/** Count a send against a variant so rate denominators stay accurate. */
export async function incrementSentCount(
  tx: Writer, tenantId: string, variantId: string,
): Promise<void> {
  await tx.update(experimentVariants).set({
    sentCount: sql`${experimentVariants.sentCount} + 1`,
    updatedAt: new Date(),
  }).where(and(eq(experimentVariants.tenantId, tenantId), eq(experimentVariants.id, variantId)));
}

export async function setWinner(
  tx: Writer, tenantId: string, id: string, variantId: string | null,
  marginPct: number | null, actorId: string, currentVersion: number,
): Promise<void> {
  await tx.update(experiments).set({
    status: "concluded",
    winnerVariantId: variantId,
    winnerMarginPct: marginPct,
    concludedAt: new Date(),
    updatedAt: new Date(),
    updatedBy: actorId,
    version: currentVersion + 1,
  }).where(and(eq(experiments.tenantId, tenantId), eq(experiments.id, id)));
}

export async function findExperimentById(
  tenantId: string, id: string,
): Promise<ExperimentRow | null> {
  const rows = await readScoped(tenantId, (tx) => tx.select().from(experiments)
    .where(and(eq(experiments.tenantId, tenantId), eq(experiments.id, id))).limit(1));
  return rows[0] ?? null;
}

export async function listExperiments(
  tenantId: string, limit: number, offset: number,
): Promise<{ rows: ExperimentRow[]; total: number }> {
  return readScoped(tenantId, async (tx) => {
    const rows = await tx.select().from(experiments)
      .where(eq(experiments.tenantId, tenantId))
      .orderBy(desc(experiments.createdAt))
      .limit(limit).offset(offset);
    const counted = await tx.select({ n: sql<number>`count(*)::int` })
      .from(experiments).where(eq(experiments.tenantId, tenantId));
    return { rows, total: counted[0]?.n ?? 0 };
  });
}

export async function listVariants(
  tenantId: string, experimentId: string,
): Promise<ExperimentVariantRow[]> {
  return readScoped(tenantId, (tx) => tx.select().from(experimentVariants)
    .where(and(
      eq(experimentVariants.tenantId, tenantId),
      eq(experimentVariants.experimentId, experimentId),
    ))
    .orderBy(experimentVariants.variantKey));
}

/**
 * GAP-NOTIFICATIONS-EXPERIMENTS-04: resolve the short variant keys for a set of
 * winner variant ids, so the experiments list can show "Variant B" instead of
 * an opaque uuid. Stays within the experiments module schema (same-module read,
 * no cross-module join). Returns an id -> key map; ids with no matching variant
 * are simply absent.
 */
export async function variantKeysByIds(
  tenantId: string, variantIds: readonly string[],
): Promise<Record<string, string>> {
  const unique = [...new Set(variantIds)].filter((v): v is string => Boolean(v));
  if (unique.length === 0) return {};
  const rows = await readScoped(tenantId, (tx) => tx.select({
    id: experimentVariants.id,
    key: experimentVariants.variantKey,
  }).from(experimentVariants)
    .where(and(
      eq(experimentVariants.tenantId, tenantId),
      inArray(experimentVariants.id, unique),
    )));
  const map: Record<string, string> = {};
  for (const r of rows) map[r.id] = r.key;
  return map;
}

export async function listEvents(
  tenantId: string, experimentId: string, limit = 10_000,
): Promise<ExperimentEventRow[]> {
  return readScoped(tenantId, (tx) => tx.select().from(experimentEvents)
    .where(and(
      eq(experimentEvents.tenantId, tenantId),
      eq(experimentEvents.experimentId, experimentId),
    ))
    .limit(limit));
}


export async function setStatus(
  tx: Writer,
  tenantId: string,
  id: string,
  status: string,
  actorId: string,
  version: number,
): Promise<void> {
  await tx.update(experiments).set({
    status,
    updatedBy: actorId,
    updatedAt: new Date(),
    version: version + 1,
  }).where(and(eq(experiments.id, id), eq(experiments.tenantId, tenantId), eq(experiments.version, version)));
}
