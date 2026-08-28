import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getGuesthouseBookings } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import { formatIndianDate } from "@/lib/formatters";
import { BookingsTable, type BookingRow } from "./BookingsTable";

export default async function GuesthousePage() {
  const { data: bookings, source } = await getGuesthouseBookings();
  const errored = source === "error";
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
          <Link href="/estab/guesthouse/new" className="btn primary" style={{ minHeight: 44 }}>+ New Booking</Link>
        }
      />
      {/* On a failed load the counts are computed from an empty list — show "—"
          rather than a fabricated 0 / 0%. */}
      <StatGrid>
        <StatCard icon="🏨" iconBg="#e6f7f5" label="Bookings" value={errored ? "—" : total.toLocaleString("en-IN")} />
        <StatCard icon="🛏️" iconBg="#eff6ff" label="Checked in" value={errored ? "—" : occupied.toLocaleString("en-IN")} />
        <StatCard icon="📋" iconBg="#fffaeb" label="Pending Approval" value={errored ? "—" : pendingApproval.toLocaleString("en-IN")} />
        <StatCard icon="🧹" iconBg="#ecfdf3" label="Upcoming" value={errored ? "—" : upcoming.toLocaleString("en-IN")} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h">
          <h3>Bookings</h3>
        </div>
        {errored ? (
          <div className="pad"><RefreshErrorState error={toHumanError("load", { area: "guest house bookings" })} /></div>
        ) : bookings.length === 0 ? (
          <EmptyState icon="🏨" title="No bookings found" message="Guest house bookings will appear here." />
        ) : (
          <BookingsTable rows={rows} />
        )}
      </div>
    </>
  );
}
