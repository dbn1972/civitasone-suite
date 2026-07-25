/**
 * Spaces repository — tenant-scoped DB access.
 *
 * Writes accept a `tx` so they run inside the caller command transaction
 * (which sets the app.tenant_id GUC via wrapWithTenantGuc for RLS).
 * Standalone reads wrap in db.transaction() so the GUC is set for RLS too.
 */
import { eq, and, inArray } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import {
  estabBuildings, estabFloors, estabOfficeRooms, estabSeats,
  estabSpaceAllotments, estabMaintenanceRequests,
} from "./schema.js";
import type {
  BuildingInsert, FloorInsert, OfficeRoomInsert, SeatInsert,
  SpaceAllotmentInsert, MaintenanceInsert, SeatRow, SpaceAllotmentRow, OfficeRoomRow,
} from "./schema.js";
import { ACTIVE_ALLOTMENT_STATUSES } from "./domain.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

// ── Inserts ────────────────────────────────────────────────────────────────
export async function insertBuilding(tx: Writer, row: BuildingInsert): Promise<void> {
  await tx.insert(estabBuildings).values(row);
}
export async function insertFloor(tx: Writer, row: FloorInsert): Promise<void> {
  await tx.insert(estabFloors).values(row);
}
export async function insertRoom(tx: Writer, row: OfficeRoomInsert): Promise<void> {
  await tx.insert(estabOfficeRooms).values(row);
}
export async function insertSeat(tx: Writer, row: SeatInsert): Promise<void> {
  await tx.insert(estabSeats).values(row);
}
export async function insertAllotment(tx: Writer, row: SpaceAllotmentInsert): Promise<void> {
  await tx.insert(estabSpaceAllotments).values(row);
}
export async function insertMaintenance(tx: Writer, row: MaintenanceInsert): Promise<void> {
  await tx.insert(estabMaintenanceRequests).values(row);
}

// ── Transactional reads within a command tx ─────────────────────────────────
export async function findSeatById(tx: Writer, tenantId: string, id: string): Promise<SeatRow | undefined> {
  const rows = await tx.select().from(estabSeats)
    .where(and(eq(estabSeats.id, id), eq(estabSeats.tenantId, tenantId))).limit(1);
  return rows[0];
}
export async function findRoomById(tx: Writer, tenantId: string, id: string): Promise<OfficeRoomRow | undefined> {
  const rows = await tx.select().from(estabOfficeRooms)
    .where(and(eq(estabOfficeRooms.id, id), eq(estabOfficeRooms.tenantId, tenantId))).limit(1);
  return rows[0];
}
export async function findAllotmentById(tx: Writer, tenantId: string, id: string): Promise<SpaceAllotmentRow | undefined> {
  const rows = await tx.select().from(estabSpaceAllotments)
    .where(and(eq(estabSpaceAllotments.id, id), eq(estabSpaceAllotments.tenantId, tenantId))).limit(1);
  return rows[0];
}
export async function findActiveSeatAllotments(tx: Writer, tenantId: string, seatId: string): Promise<SpaceAllotmentRow[]> {
  return tx.select().from(estabSpaceAllotments).where(and(
    eq(estabSpaceAllotments.tenantId, tenantId),
    eq(estabSpaceAllotments.targetType, "seat"),
    eq(estabSpaceAllotments.targetId, seatId),
    inArray(estabSpaceAllotments.status, [...ACTIVE_ALLOTMENT_STATUSES]),
  ));
}
export async function findActiveRoomAllotments(tx: Writer, tenantId: string, roomId: string): Promise<SpaceAllotmentRow[]> {
  return tx.select().from(estabSpaceAllotments).where(and(
    eq(estabSpaceAllotments.tenantId, tenantId),
    eq(estabSpaceAllotments.targetType, "room"),
    eq(estabSpaceAllotments.targetId, roomId),
    inArray(estabSpaceAllotments.status, [...ACTIVE_ALLOTMENT_STATUSES]),
  ));
}

// ── Updates (optimistic on version) ─────────────────────────────────────────
// Versioned UPDATEs RETURNING the id so callers can detect lost updates:
// a matched-0-rows result means a concurrent writer bumped `version` and the
// command layer must abort (VERSION_CONFLICT) before firing side effects.
export async function updateAllotment(
  tx: Writer, id: string, expectedVersion: number, patch: Partial<SpaceAllotmentInsert>,
): Promise<number> {
  const rows = await tx.update(estabSpaceAllotments)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(estabSpaceAllotments.id, id), eq(estabSpaceAllotments.version, expectedVersion)))
    .returning({ id: estabSpaceAllotments.id });
  return rows.length;
}
export async function updateSeatStatus(tx: Writer, id: string, status: string, updatedBy: string): Promise<void> {
  await tx.update(estabSeats)
    .set({ status, updatedBy, updatedAt: new Date() })
    .where(eq(estabSeats.id, id));
}
export async function updateMaintenance(
  tx: Writer, id: string, expectedVersion: number, patch: Partial<MaintenanceInsert>,
): Promise<number> {
  const rows = await tx.update(estabMaintenanceRequests)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(estabMaintenanceRequests.id, id), eq(estabMaintenanceRequests.version, expectedVersion)))
    .returning({ id: estabMaintenanceRequests.id });
  return rows.length;
}

// ── Tenant-scoped transaction ────────────────────────────────────────────────
// Establishes the AsyncLocalStorage tenant context so wrapWithTenantGuc injects
// app.tenant_id (RLS) for BOTH reads and writes on the synchronous request path.
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export function scopedTx<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return Promise.resolve(runWithTenant(tenantId, () => db.transaction(fn))) as Promise<T>;
}
