import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { estabFacilitiesCatalog, estabBookings, estabBookingCalendar } from "./schema.js";

export interface ListPage<T> {
  data: T[];
  pagination: { hasMore: boolean; pageSize: number; cursor?: string };
}

// PERF-006: both list*() functions below used to return the WHOLE tenant's
// rows with no limit/offset at all -- fine while every tenant had a handful
// of bookings, unbounded (and a real memory/latency risk) once a facility's
// booking history grows over years. Shape matches the pagination convention
// used elsewhere in the fleet (e.g. crm-service contacts/queries.ts,
// hrms-service employee/queries.ts): `cursor` is an opaque offset-encoded
// token, not a real keyset cursor, but that's what every other paginated
// route here does, and routes.ts's listQuery already validates limit/offset.
function paginate<T>(rows: T[], limit: number, offset: number): ListPage<T> {
  return {
    data: rows,
    pagination: {
      hasMore: rows.length === limit,
      pageSize: limit,
      ...(rows.length > 0 ? { cursor: String(offset + rows.length) } : {}),
    },
  };
}

export async function listFacilities(
  tenantId: string,
  q: { status?: string | undefined },
  limit: number,
  offset: number,
): Promise<ListPage<unknown>> {
  const rows = q.status
    ? await db.select().from(estabFacilitiesCatalog)
        .where(and(eq(estabFacilitiesCatalog.tenantId, tenantId), eq(estabFacilitiesCatalog.status, q.status)))
        .limit(limit).offset(offset)
    : await db.select().from(estabFacilitiesCatalog)
        .where(eq(estabFacilitiesCatalog.tenantId, tenantId))
        .limit(limit).offset(offset);
  return paginate(rows, limit, offset);
}

export async function getFacility(tenantId: string, id: string): Promise<unknown | undefined> {
  const rows = await db.select().from(estabFacilitiesCatalog)
    .where(and(eq(estabFacilitiesCatalog.tenantId, tenantId), eq(estabFacilitiesCatalog.id, id)))
    .limit(1);
  return rows[0];
}

export async function getFacilityAvailability(tenantId: string, facilityId: string, date: string): Promise<unknown[]> {
  // Scoped to one facility + one date, not tenant-wide -- naturally bounded
  // by real-world cardinality (a day's worth of slots), so out of scope for
  // PERF-006 and left as-is.
  return db.select().from(estabBookingCalendar)
    .where(and(
      eq(estabBookingCalendar.tenantId, tenantId),
      eq(estabBookingCalendar.facilityId, facilityId),
      eq(estabBookingCalendar.bookingDate, date),
    ));
}

export async function listBookings(
  tenantId: string,
  q: { status?: string | undefined },
  limit: number,
  offset: number,
): Promise<ListPage<unknown>> {
  const rows = q.status
    ? await db.select().from(estabBookings)
        .where(and(eq(estabBookings.tenantId, tenantId), eq(estabBookings.status, q.status)))
        .limit(limit).offset(offset)
    : await db.select().from(estabBookings)
        .where(eq(estabBookings.tenantId, tenantId))
        .limit(limit).offset(offset);
  return paginate(rows, limit, offset);
}

export async function getBooking(tenantId: string, id: string): Promise<unknown | undefined> {
  const rows = await db.select().from(estabBookings)
    .where(and(eq(estabBookings.tenantId, tenantId), eq(estabBookings.id, id)))
    .limit(1);
  return rows[0];
}
