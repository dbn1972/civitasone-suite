import { eq, and, desc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import {
  assetStreetlights, assetStreetlightFaults, assetStreetlightRequests,
  type StreetlightInsert, type StreetlightRow,
  type StreetlightFaultInsert, type StreetlightFaultRow,
  type StreetlightRequestInsert, type StreetlightRequestRow,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

// ── streetlights ─────────────────────────────────────────────────────────

export async function insertStreetlight(tx: Writer, row: StreetlightInsert): Promise<void> {
  await tx.insert(assetStreetlights).values(row);
}

export async function findStreetlightById(id: string, tenantId: string): Promise<StreetlightRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(assetStreetlights)
      .where(and(eq(assetStreetlights.id, id), eq(assetStreetlights.tenantId, tenantId)))
      .limit(1));
  return rows[0] ?? null;
}

export async function updateStreetlightStatus(
  tx: Writer, id: string, tenantId: string, status: string, extra?: Record<string, unknown>,
): Promise<void> {
  await (tx as typeof db).update(assetStreetlights)
    .set({ status, updatedAt: new Date(), ...extra })
    .where(and(eq(assetStreetlights.id, id), eq(assetStreetlights.tenantId, tenantId)));
}

export async function listStreetlights(tenantId: string, opts?: { limit?: number; offset?: number }) {
  return scopedRead((tx) => tx.select().from(assetStreetlights)
    .where(eq(assetStreetlights.tenantId, tenantId))
    .orderBy(desc(assetStreetlights.createdAt))
    .limit(opts?.limit ?? 50)
    .offset(opts?.offset ?? 0));
}

// ── faults ───────────────────────────────────────────────────────────────

export async function insertFault(tx: Writer, row: StreetlightFaultInsert): Promise<void> {
  await tx.insert(assetStreetlightFaults).values(row);
}

export async function findFaultById(id: string, tenantId: string): Promise<StreetlightFaultRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(assetStreetlightFaults)
      .where(and(eq(assetStreetlightFaults.id, id), eq(assetStreetlightFaults.tenantId, tenantId)))
      .limit(1));
  return rows[0] ?? null;
}

export async function updateFaultStatus(
  tx: Writer, id: string, tenantId: string, status: string, extra?: Record<string, unknown>,
): Promise<void> {
  await (tx as typeof db).update(assetStreetlightFaults)
    .set({ status, updatedAt: new Date(), ...extra })
    .where(and(eq(assetStreetlightFaults.id, id), eq(assetStreetlightFaults.tenantId, tenantId)));
}

export async function listFaults(tenantId: string, opts?: { limit?: number; offset?: number }) {
  return scopedRead((tx) => tx.select().from(assetStreetlightFaults)
    .where(eq(assetStreetlightFaults.tenantId, tenantId))
    .orderBy(desc(assetStreetlightFaults.reportedAt))
    .limit(opts?.limit ?? 50)
    .offset(opts?.offset ?? 0));
}

// ── requests ─────────────────────────────────────────────────────────────

export async function insertRequest(tx: Writer, row: StreetlightRequestInsert): Promise<void> {
  await tx.insert(assetStreetlightRequests).values(row);
}

export async function findRequestById(id: string, tenantId: string): Promise<StreetlightRequestRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(assetStreetlightRequests)
      .where(and(eq(assetStreetlightRequests.id, id), eq(assetStreetlightRequests.tenantId, tenantId)))
      .limit(1));
  return rows[0] ?? null;
}

export async function updateRequestStatus(
  tx: Writer, id: string, tenantId: string, status: string, extra?: Record<string, unknown>,
): Promise<void> {
  await (tx as typeof db).update(assetStreetlightRequests)
    .set({ status, updatedAt: new Date(), ...extra })
    .where(and(eq(assetStreetlightRequests.id, id), eq(assetStreetlightRequests.tenantId, tenantId)));
}

export async function listRequests(tenantId: string, opts?: { limit?: number; offset?: number }) {
  return scopedRead((tx) => tx.select().from(assetStreetlightRequests)
    .where(eq(assetStreetlightRequests.tenantId, tenantId))
    .orderBy(desc(assetStreetlightRequests.createdAt))
    .limit(opts?.limit ?? 50)
    .offset(opts?.offset ?? 0));
}
