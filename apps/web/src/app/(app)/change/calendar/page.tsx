import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid, EmptyState, StatusPill } from "../../../_components/ds";
import { getChangeRequests, getChangeFreezes } from "../_data/loaders";
import { formatIndianDate } from "@/lib/formatters";

export default async function Page() {
  const [{ data: changes, source: cSource }, { data: freezes, source: fSource }] = await Promise.all([
    getChangeRequests(),
    getChangeFreezes(),
  ]);
  const source = cSource === "error" || fSource === "error" ? "error" : "api";

  const scheduled = changes
    .filter((c) => c.windowStart && (c.status === "scheduled" || c.status === "in_progress"))
    .sort((a, b) => new Date(a.windowStart ?? 0).getTime() - new Date(b.windowStart ?? 0).getTime());

  const sortedFreezes = [...freezes].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );

  return (
    <>
      <PageHeader title="Release calendar" subtitle="Scheduled release windows and active change freezes." back="/change" />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="🗓️" iconBg="#ecfdf5" label="Scheduled releases" value={scheduled.length.toLocaleString("en-IN")} />
        <StatCard icon="🧊" iconBg="#eff6ff" label="Change freezes" value={freezes.length.toLocaleString("en-IN")} />
      </StatGrid>

      <div className="card">
        <div className="card-h"><h3>Upcoming release windows</h3></div>
        {scheduled.length === 0 ? (
          <EmptyState icon="🗓️" title="No scheduled releases" message="Approved changes with a booked window appear here." />
        ) : (
          <table className="tbl" style={{ width: "100%" }}>
            <thead><tr><th>Change</th><th>Type</th><th>Status</th><th>Window start</th><th>Window end</th></tr></thead>
            <tbody>
              {scheduled.map((c) => (
                <tr key={c.id}>
                  <td><a href={`/change/${c.id}`}>{c.title}</a></td>
                  <td>{c.type}</td>
                  <td><StatusPill status={c.status} /></td>
                  <td>{c.windowStart ? formatIndianDate(c.windowStart) : "—"}</td>
                  <td>{c.windowEnd ? formatIndianDate(c.windowEnd) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="card-h"><h3>Change freezes</h3></div>
        {sortedFreezes.length === 0 ? (
          <EmptyState icon="🧊" title="No change freezes" message="Freeze windows block scheduling of overlapping releases." />
        ) : (
          <table className="tbl" style={{ width: "100%" }}>
            <thead><tr><th>Name</th><th>Starts</th><th>Ends</th><th>Reason</th></tr></thead>
            <tbody>
              {sortedFreezes.map((f) => (
                <tr key={f.id}>
                  <td>{f.name}</td>
                  <td>{formatIndianDate(f.startsAt)}</td>
                  <td>{formatIndianDate(f.endsAt)}</td>
                  <td>{f.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
