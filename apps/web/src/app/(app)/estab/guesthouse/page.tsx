import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getGuesthouseBookings } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, EmptyState, RefreshErrorState, Button } from "../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import { formatIndianDateTime } from "@/lib/formatters";
import { countGuesthouseStats } from "@/lib/estab/guesthouseStats";
import { BookingsTable, type BookingRow } from "./BookingsTable";

export default async function GuesthousePage() {
  const { data: bookings, source } = await getGuesthouseBookings();
  const errored = source === "error";
  const { total, occupied, pendingApproval, upcoming } = countGuesthouseStats(bookings);

  const rows: BookingRow[] = bookings.map((b) => ({
    id: b.id,
    bookingNo: b.bookingNo,
    guest: `${b.guestName}${b.designation ? ` · ${b.designation}` : ""}`,
    department: b.department ?? "—",
    room: b.roomNo ?? b.roomType ?? "—",
    checkIn: formatIndianDateTime(b.checkInDate),
    checkOut: formatIndianDateTime(b.checkOutDate),
    status: b.status.replace(/_/g, " "),
    statusRaw: b.status,
  }));

  return (
    <>
      {source === "error" && <DataSourceBadge source={source} />}
      <PageHeader
        title="Guest House Management"
        subtitle="Room booking and approvals."
        back="/estab"
        actions={
          <Link href="/estab/guesthouse/new" className="btn primary" style={{ minHeight: 44 }}>+ New Booking</Link>
        }
      />
      {/* On a failed load the counts are computed from an empty list — show "—"
          rather than a fabricated 0 / 0%. */}
      <StatGrid>
        <StatCard icon="🏨" iconBg="#e6f7f5" label="Bookings" value={errored ? "—" : total.toLocaleString("en-IN")} />
        <StatCard icon="🛏️" iconBg="#eff6ff" label="Checked in" value={errored ? "—" : occupied.toLocaleString("en-IN")} />
        <StatCard icon="📋" iconBg="#fffaeb" label="Awaiting check-in" value={errored ? "—" : pendingApproval.toLocaleString("en-IN")} />
        <StatCard icon="🧹" iconBg="#ecfdf3" label="Upcoming" value={errored ? "—" : upcoming.toLocaleString("en-IN")} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h">
          <h3>Bookings</h3>
        </div>
        {errored ? (
          <div className="pad"><RefreshErrorState error={toHumanError("load", { area: "guest house bookings" })} /></div>
        ) : bookings.length === 0 ? (
          <EmptyState
            icon="🏨"
            title="No bookings found"
            message="Guest house bookings will appear here."
            action={
              <Link href="/estab/guesthouse/new">
                <Button type="button">+ New Booking</Button>
              </Link>
            }
          />
        ) : (
          <BookingsTable rows={rows} />
        )}
      </div>
    </>
  );
}
