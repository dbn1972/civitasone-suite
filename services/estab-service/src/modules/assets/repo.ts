import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { estabVehicles, estabVehicleBookings } from "./schema.js";
import type { VehicleRow, VehicleInsert, VehicleBookingRow, VehicleBookingInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findVehicleById(id: string, tenantId: string): Promise<VehicleRow | null> {
  const rows = await db.select().from(estabVehicles)
    .where(and(eq(estabVehicles.id, id), eq(estabVehicles.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findBookingsByVehicle(vehicleId: string): Promise<VehicleBookingRow[]> {
  return db.select().from(estabVehicleBookings).where(eq(estabVehicleBookings.vehicleId, vehicleId));
}

export async function findBookingById(id: string): Promise<VehicleBookingRow | null> {
  const rows = await db.select().from(estabVehicleBookings).where(eq(estabVehicleBookings.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function insertVehicle(tx: Writer, row: VehicleInsert): Promise<void> {
  await tx.insert(estabVehicles).values(row);
}

export async function insertBooking(tx: Writer, row: VehicleBookingInsert): Promise<void> {
  await tx.insert(estabVehicleBookings).values(row);
}

export async function updateBooking(tx: Writer, id: string, patch: Partial<VehicleBookingInsert>): Promise<void> {
  await tx.update(estabVehicleBookings).set({ ...patch, updatedAt: new Date() }).where(eq(estabVehicleBookings.id, id));
}

export async function updateVehicle(tx: Writer, id: string, patch: Partial<VehicleInsert>): Promise<void> {
  await tx.update(estabVehicles).set({ ...patch, updatedAt: new Date() }).where(eq(estabVehicles.id, id));
}
