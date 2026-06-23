import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getGuesthouseBookings } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, StatusPill, EmptyState } from "../../../_components/ds";

export default async function GuesthousePage() {
  const { data: bookings, source } = await getGuesthouseBookings();
  const today = new Date().toISOString().split("T")[0];
  const total = bookings.length;
  const occupied = bookings.filter((b) => b.status === "checked_in").length;
  const pendingApproval = bookings.filter((b) => b.status === "pending").length;
  const upcoming = bookings.filter((b) => b.status === "confirmed" && b.checkInDate > today).length;

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
        <div className="card-h">
          <h3>Bookings</h3>
          <div className="seg">
            <span className="on">All</span>
            <span>Pending</span>
            <span>In-house</span>
          </div>
        </div>
        {bookings.length === 0 ? (
          <EmptyState icon="🏨" title="No bookings found" message="Guest house bookings will appear here." />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Ref</th>
                <th>Guest</th>
                <th>Room</th>
                <th>Dates</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => (
                <tr key={b.id}>
                  <td><span className="mono">{b.bookingNo}</span></td>
                  <td>{b.guestName}{b.designation ? ` · ${b.designation}` : ""}</td>
                  <td>{b.roomNo ?? b.roomType ?? "—"}</td>
                  <td>{b.checkInDate} – {b.checkOutDate}</td>
                  <td>
                    <StatusPill status={b.status.replace(/_/g, " ")} label={b.status.replace(/_/g, " ")} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
