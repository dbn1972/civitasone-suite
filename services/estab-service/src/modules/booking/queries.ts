import { eq, and, type SQL } from "drizzle-orm";
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
// Review follow-up: orderBy(id) on every limit/offset query below keeps the
// row partition stable across page fetches (offset pagination with no
// deterministic order has no guaranteed stable split across calls) --
// matches this same PR's hrms-service fixes (ai-fraud/routes.ts).
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
  // GAP2-ESTAB-BOOKING-ORPHAN-01: reads go through db.transaction() so the
  // per-tenant app.tenant_id GUC is set (wrapWithTenantGuc) — the booking
  // tables are FORCE RLS, so a plain db.select() would fail CLOSED (empty)
  // for every tenant. Mirrors fleet/consumables queries in this service.
  const rows = q.status
    ? await db.transaction((tx) => tx.select().from(estabFacilitiesCatalog)
        .where(and(eq(estabFacilitiesCatalog.tenantId, tenantId), eq(estabFacilitiesCatalog.status, q.status!)))
        .orderBy(estabFacilitiesCatalog.id)
        .limit(limit).offset(offset))
    : await db.transaction((tx) => tx.select().from(estabFacilitiesCatalog)
        .where(eq(estabFacilitiesCatalog.tenantId, tenantId))
        .orderBy(estabFacilitiesCatalog.id)
        .limit(limit).offset(offset));
  return paginate(rows, limit, offset);
}

export async function getFacility(tenantId: string, id: string): Promise<unknown | undefined> {
  const rows = await db.transaction((tx) => tx.select().from(estabFacilitiesCatalog)
    .where(and(eq(estabFacilitiesCatalog.tenantId, tenantId), eq(estabFacilitiesCatalog.id, id)))
    .limit(1));
  return rows[0];
}

export async function getFacilityAvailability(tenantId: string, facilityId: string, date: string): Promise<unknown[]> {
  // Scoped to one facility + one date, not tenant-wide -- naturally bounded
  // by real-world cardinality (a day's worth of slots), so out of scope for
  // PERF-006.
  return db.transaction((tx) => tx.select().from(estabBookingCalendar)
    .where(and(
      eq(estabBookingCalendar.tenantId, tenantId),
      eq(estabBookingCalendar.facilityId, facilityId),
      eq(estabBookingCalendar.bookingDate, date),
    )));
}

export async function listBookings(
  tenantId: string,
  q: { status?: string | undefined; ownerId?: string | undefined },
  limit: number,
  offset: number,
): Promise<ListPage<unknown>> {
  // IDOR: ownerId (set for citizen/employee callers) restricts to rows they created.
  const conds: SQL[] = [eq(estabBookings.tenantId, tenantId)];
  if (q.status) conds.push(eq(estabBookings.status, q.status));
  if (q.ownerId) conds.push(eq(estabBookings.createdBy, q.ownerId));
  const rows = await db.transaction((tx) => tx.select().from(estabBookings)
    .where(and(...conds))
    .orderBy(estabBookings.id)
    .limit(limit).offset(offset));
  return paginate(rows, limit, offset);
}

export async function getBooking(tenantId: string, id: string, ownerId?: string): Promise<unknown | undefined> {
  const rows = await db.transaction((tx) => tx.select().from(estabBookings)
    .where(and(eq(estabBookings.tenantId, tenantId), eq(estabBookings.id, id), ...(ownerId ? [eq(estabBookings.createdBy, ownerId)] : [])))
    .limit(1));
  return rows[0];
}
