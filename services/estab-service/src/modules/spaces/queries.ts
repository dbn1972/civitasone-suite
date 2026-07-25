/**
 * Spaces read queries — all tenant-scoped via scopedTx(tenantId, ) (RLS GUC).
 */
import { eq, and, inArray, type SQL } from "drizzle-orm";
import { scopedTx } from "./repo.js";
import {
  estabBuildings, estabFloors, estabOfficeRooms, estabSeats,
  estabSpaceAllotments, estabMaintenanceRequests,
  type BuildingRow, type FloorRow, type OfficeRoomRow, type SeatRow,
  type SpaceAllotmentRow, type MaintenanceRow,
} from "./schema.js";
import { computeOccupancy, availableSeats, type Occupancy } from "./domain.js";

export async function listBuildings(
  tenantId: string, opts: { status?: string | undefined; limit: number; offset: number },
): Promise<BuildingRow[]> {
  const conds: SQL[] = [eq(estabBuildings.tenantId, tenantId)];
  if (opts.status) conds.push(eq(estabBuildings.status, opts.status));
  return scopedTx(tenantId, (tx) => tx.select().from(estabBuildings)
    .where(and(...conds)).limit(opts.limit).offset(opts.offset));
}

export async function getBuilding(tenantId: string, id: string): Promise<BuildingRow | null> {
  const rows = await scopedTx(tenantId, (tx) => tx.select().from(estabBuildings)
    .where(and(eq(estabBuildings.id, id), eq(estabBuildings.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

export async function listFloors(
  tenantId: string, opts: { buildingId?: string | undefined; limit: number; offset: number },
): Promise<FloorRow[]> {
  const conds: SQL[] = [eq(estabFloors.tenantId, tenantId)];
  if (opts.buildingId) conds.push(eq(estabFloors.buildingId, opts.buildingId));
  return scopedTx(tenantId, (tx) => tx.select().from(estabFloors)
    .where(and(...conds)).limit(opts.limit).offset(opts.offset));
}

export async function listRooms(
  tenantId: string, opts: { floorId?: string | undefined; limit: number; offset: number },
): Promise<OfficeRoomRow[]> {
  const conds: SQL[] = [eq(estabOfficeRooms.tenantId, tenantId)];
  if (opts.floorId) conds.push(eq(estabOfficeRooms.floorId, opts.floorId));
  return scopedTx(tenantId, (tx) => tx.select().from(estabOfficeRooms)
    .where(and(...conds)).limit(opts.limit).offset(opts.offset));
}

export async function listSeats(
  tenantId: string, opts: { roomId?: string | undefined; status?: string | undefined; limit: number; offset: number },
): Promise<SeatRow[]> {
  const conds: SQL[] = [eq(estabSeats.tenantId, tenantId)];
  if (opts.roomId) conds.push(eq(estabSeats.roomId, opts.roomId));
  if (opts.status) conds.push(eq(estabSeats.status, opts.status));
  return scopedTx(tenantId, (tx) => tx.select().from(estabSeats)
    .where(and(...conds)).limit(opts.limit).offset(opts.offset));
}

/**
 * Availability + occupancy for a room / floor / building.
 * Resolves the seat set for the scope, then computes occupancy from live status.
 */
export async function availability(
  tenantId: string, scope: { roomId?: string | undefined; floorId?: string | undefined; buildingId?: string | undefined },
): Promise<{ occupancy: Occupancy; available: SeatRow[] }> {
  const seats = await scopedTx(tenantId, async (tx) => {
    let roomIds: string[] | null = null;
    if (scope.roomId) {
      roomIds = [scope.roomId];
    } else if (scope.floorId) {
      const rooms = await tx.select({ id: estabOfficeRooms.id }).from(estabOfficeRooms)
        .where(and(eq(estabOfficeRooms.tenantId, tenantId), eq(estabOfficeRooms.floorId, scope.floorId)));
      roomIds = rooms.map((r) => r.id);
    } else if (scope.buildingId) {
      const floors = await tx.select({ id: estabFloors.id }).from(estabFloors)
        .where(and(eq(estabFloors.tenantId, tenantId), eq(estabFloors.buildingId, scope.buildingId)));
      const floorIds = floors.map((f) => f.id);
      if (floorIds.length === 0) { roomIds = []; }
      else {
        const rooms = await tx.select({ id: estabOfficeRooms.id }).from(estabOfficeRooms)
          .where(and(eq(estabOfficeRooms.tenantId, tenantId), inArray(estabOfficeRooms.floorId, floorIds)));
        roomIds = rooms.map((r) => r.id);
      }
    }
    if (!roomIds || roomIds.length === 0) return [] as SeatRow[];
    return tx.select().from(estabSeats)
      .where(and(eq(estabSeats.tenantId, tenantId), inArray(estabSeats.roomId, roomIds)));
  });
  return { occupancy: computeOccupancy(seats), available: availableSeats(seats) };
}

export async function listAllotments(
  tenantId: string,
  opts: { status?: string | undefined; targetType?: string | undefined; employeeRef?: string | undefined; limit: number; offset: number },
): Promise<SpaceAllotmentRow[]> {
  const conds: SQL[] = [eq(estabSpaceAllotments.tenantId, tenantId)];
  if (opts.status) conds.push(eq(estabSpaceAllotments.status, opts.status));
  if (opts.targetType) conds.push(eq(estabSpaceAllotments.targetType, opts.targetType));
  if (opts.employeeRef) conds.push(eq(estabSpaceAllotments.employeeRef, opts.employeeRef));
  return scopedTx(tenantId, (tx) => tx.select().from(estabSpaceAllotments)
    .where(and(...conds)).limit(opts.limit).offset(opts.offset));
}

export async function listMaintenance(
  tenantId: string, opts: { status?: string | undefined; assetType?: string | undefined; limit: number; offset: number },
): Promise<MaintenanceRow[]> {
  const conds: SQL[] = [eq(estabMaintenanceRequests.tenantId, tenantId)];
  if (opts.status) conds.push(eq(estabMaintenanceRequests.status, opts.status));
  if (opts.assetType) conds.push(eq(estabMaintenanceRequests.assetType, opts.assetType));
  return scopedTx(tenantId, (tx) => tx.select().from(estabMaintenanceRequests)
    .where(and(...conds)).limit(opts.limit).offset(opts.offset));
}
