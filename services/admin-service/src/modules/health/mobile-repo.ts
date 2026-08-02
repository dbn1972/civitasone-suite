/**
 * CR-MOB-01 — DB access for mobile telemetry. Reads via scopedRead() so RLS is
 * enforced; the ingest write takes the caller's transaction.
 */
import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import {
  mobileTelemetryEvents,
  mobileScreenRenders,
  type MobileTelemetryRow,
  type MobileTelemetryInsert,
  type MobileScreenRenderInsert,
} from "./mobile-schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;
// Drizzle's insert/update builders expose `.returning()` and
// `.returning({ col })`; this narrow structural type covers both without
// pulling the full builder generics into every repo signature.
type Returning<T> = { returning: (fields?: Record<string, unknown>) => Promise<T[]> };

export interface TelemetryFilter {
  platform?: string | undefined;
  appVersion?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
}

export async function insertTelemetry(tx: Writer, row: MobileTelemetryInsert): Promise<MobileTelemetryRow> {
  const rows = await (tx.insert(mobileTelemetryEvents).values(row) as unknown as Returning<MobileTelemetryRow>).returning();
  const created = rows[0];
  if (!created) throw new Error("insertTelemetry: no row returned");
  return created;
}

export async function insertScreenRenders(tx: Writer, rows: MobileScreenRenderInsert[]): Promise<void> {
  if (rows.length === 0) return;
  await tx.insert(mobileScreenRenders).values(rows);
}

function telemetryWhere(tenantId: string, f: TelemetryFilter): SQL | undefined {
  const clauses: SQL[] = [eq(mobileTelemetryEvents.tenantId, tenantId)];
  if (f.platform !== undefined) clauses.push(eq(mobileTelemetryEvents.platform, f.platform));
  if (f.appVersion !== undefined) clauses.push(eq(mobileTelemetryEvents.appVersion, f.appVersion));
  if (f.from !== undefined) clauses.push(gte(mobileTelemetryEvents.recordedAt, f.from));
  if (f.to !== undefined) clauses.push(lte(mobileTelemetryEvents.recordedAt, f.to));
  return and(...clauses);
}

/** Raw events for the list endpoint. */
export async function listTelemetry(
  tenantId: string, filter: TelemetryFilter, limit: number, offset: number,
): Promise<{ rows: MobileTelemetryRow[]; total: number }> {
  const where = telemetryWhere(tenantId, filter);
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(mobileTelemetryEvents).where(where)
      .orderBy(desc(mobileTelemetryEvents.recordedAt)).limit(limit).offset(offset);
    const counted = await tx.select({ n: sql<number>`count(*)::int` }).from(mobileTelemetryEvents).where(where);
    return { rows, total: counted[0]?.n ?? 0 };
  });
}

/**
 * Samples for aggregation. `limit` caps how many events are pulled into the
 * aggregate so a wide date range can never produce an unbounded SELECT.
 */
export async function aggregateSamples(
  tenantId: string, filter: TelemetryFilter, limit: number,
): Promise<Array<{ platform: string; appVersion: string; coldStartMs: number; crashCount: number; anrCount: number; sessionCount: number }>> {
  const where = telemetryWhere(tenantId, filter);
  return scopedRead((tx) => tx.select({
    platform: mobileTelemetryEvents.platform,
    appVersion: mobileTelemetryEvents.appVersion,
    coldStartMs: mobileTelemetryEvents.coldStartMs,
    crashCount: mobileTelemetryEvents.crashCount,
    anrCount: mobileTelemetryEvents.anrCount,
    sessionCount: mobileTelemetryEvents.sessionCount,
  }).from(mobileTelemetryEvents).where(where)
    .orderBy(desc(mobileTelemetryEvents.recordedAt)).limit(limit));
}

export interface ScreenFilter extends TelemetryFilter {
  screen?: string | undefined;
}

export async function screenSamples(
  tenantId: string, filter: ScreenFilter, limit: number,
): Promise<Array<{ screen: string; renderMs: number; sampleCount: number }>> {
  const clauses: SQL[] = [eq(mobileScreenRenders.tenantId, tenantId)];
  if (filter.platform !== undefined) clauses.push(eq(mobileScreenRenders.platform, filter.platform));
  if (filter.appVersion !== undefined) clauses.push(eq(mobileScreenRenders.appVersion, filter.appVersion));
  if (filter.screen !== undefined) clauses.push(eq(mobileScreenRenders.screen, filter.screen));
  if (filter.from !== undefined) clauses.push(gte(mobileScreenRenders.recordedAt, filter.from));
  if (filter.to !== undefined) clauses.push(lte(mobileScreenRenders.recordedAt, filter.to));
  const where = and(...clauses);
  return scopedRead((tx) => tx.select({
    screen: mobileScreenRenders.screen,
    renderMs: mobileScreenRenders.renderMs,
    sampleCount: mobileScreenRenders.sampleCount,
  }).from(mobileScreenRenders).where(where)
    .orderBy(desc(mobileScreenRenders.recordedAt)).limit(limit));
}
