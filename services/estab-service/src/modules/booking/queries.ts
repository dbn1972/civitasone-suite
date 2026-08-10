import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { estabFacilitiesCatalog, estabBookings, estabBookingCalendar } from "./schema.js";

export async function listFacilities(tenantId: string, q: { status?: string | undefined }): Promise<unknown[]> {
  if (q.status) {
    return db.select().from(estabFacilitiesCatalog)
      .where(and(eq(estabFacilitiesCatalog.tenantId, tenantId), eq(estabFacilitiesCatalog.status, q.status)));
  }
  return db.select().from(estabFacilitiesCatalog).where(eq(estabFacilitiesCatalog.tenantId, tenantId));
}

export async function getFacility(tenantId: string, id: string): Promise<unknown | undefined> {
  const rows = await db.select().from(estabFacilitiesCatalog)
    .where(and(eq(estabFacilitiesCatalog.tenantId, tenantId), eq(estabFacilitiesCatalog.id, id)))
    .limit(1);
  return rows[0];
}

export async function getFacilityAvailability(tenantId: string, facilityId: string, date: string): Promise<unknown[]> {
  return db.select().from(estabBookingCalendar)
    .where(and(
      eq(estabBookingCalendar.tenantId, tenantId),
      eq(estabBookingCalendar.facilityId, facilityId),
      eq(estabBookingCalendar.bookingDate, date),
    ));
}

export async function listBookings(tenantId: string, q: { status?: string | undefined }): Promise<unknown[]> {
  if (q.status) {
    return db.select().from(estabBookings)
      .where(and(eq(estabBookings.tenantId, tenantId), eq(estabBookings.status, q.status)));
  }
  return db.select().from(estabBookings).where(eq(estabBookings.tenantId, tenantId));
}

export async function getBooking(tenantId: string, id: string): Promise<unknown | undefined> {
  const rows = await db.select().from(estabBookings)
    .where(and(eq(estabBookings.tenantId, tenantId), eq(estabBookings.id, id)))
    .limit(1);
  return rows[0];
}
