import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getGuesthouseBookings } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, EmptyState } from "../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { BookingsTable, type BookingRow } from "./BookingsTable";

export default async function GuesthousePage() {
  const { data: bookings, source } = await getGuesthouseBookings();
  const today = new Date().toISOString().split("T")[0];
  const total = bookings.length;
  const occupied = bookings.filter((b) => b.status === "checked_in").length;
  const pendingApproval = bookings.filter((b) => b.status === "pending").length;
  const upcoming = bookings.filter((b) => b.status === "confirmed" && b.checkInDate > today).length;

  const rows: BookingRow[] = bookings.map((b) => ({
    id: b.id,
    bookingNo: b.bookingNo,
    guest: `${b.guestName}${b.designation ? ` · ${b.designation}` : ""}`,
    room: b.roomNo ?? b.roomType ?? "—",
    dates: `${formatIndianDate(b.checkInDate)} – ${formatIndianDate(b.checkOutDate)}`,
    status: b.status.replace(/_/g, " "),
    statusRaw: b.status,
  }));

  return (
    <>
      {source === "error" && <DataSourceBadge source={source} />}
      <PageHeader
        title="Guest House Management"
        subtitle="Room booking, approvals and occupancy management."
        actions={
          <>
            <button className="btn ghost">Room chart</button>
            <button className="btn primary">+ New Booking</button>
          </>
        }
      />
      <StatGrid>
        <StatCard icon="🏨" iconBg="#e6f7f5" label="Rooms" value={total.toLocaleString("en-IN")} />
        <StatCard icon="🛏️" iconBg="#eff6ff" label="Occupancy" value={`${total > 0 ? Math.round((occupied / total) * 100) : 0}%`} />
        <StatCard icon="📋" iconBg="#fffaeb" label="Pending Approval" value={pendingApproval.toLocaleString("en-IN")} />
        <StatCard icon="🧹" iconBg="#ecfdf3" label="Available Today" value={upcoming.toLocaleString("en-IN")} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        {bookings.length === 0 ? (
          <>
            <div className="card-h">
              <h3>Bookings</h3>
            </div>
            <EmptyState icon="🏨" title="No bookings found" message="Guest house bookings will appear here." />
          </>
        ) : (
          <BookingsTable rows={rows} />
        )}
      </div>
    </>
  );
}
