import { cache } from "../../shared/infra.js";
import * as repo from "./repo.js";

function mapBookingStatus(status: string): "pending" | "confirmed" | "checked_in" | "checked_out" | "cancelled" {
  if (status === "confirmed" || status === "booked") return "confirmed";
  if (status === "checked_in") return "checked_in";
  if (status === "checked_out") return "checked_out";
  if (status === "cancelled") return "cancelled";
  return "pending";
}

export async function listGuesthouseBookingSummaries(tenantId: string, limit: number) {
  const rows = await cache.getOrLoad(
    cache.makeKey(tenantId, "guesthouse_bookings", `list:${limit}`),
    () => repo.listRoomBookingsByTenant(tenantId, limit),
  );
  return (rows ?? []).map((row) => ({
    id: row.id,
    bookingNo: row.id.slice(0, 8).toUpperCase(),
    guestName: row.guestName,
    department: row.sponsorDept ?? undefined,
    checkInDate: new Date(row.checkIn as unknown as string).toISOString().slice(0, 10),
    checkOutDate: new Date(row.checkOut as unknown as string).toISOString().slice(0, 10),
    status: mapBookingStatus(row.status),
  }));
}
