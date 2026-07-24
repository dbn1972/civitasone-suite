import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid, EmptyState } from "../../../_components/ds";
import { getChangeRequests } from "../_data/loaders";
import { formatIndianDate } from "@/lib/formatters";

export default async function Page() {
  const { data: changes, source } = await getChangeRequests();

  // Released changes that carry user-communication release notes.
  const released = changes
    .filter((c) => c.status === "completed" && c.releaseNotes)
    .sort((a, b) => new Date(b.pirAt ?? b.updatedAt).getTime() - new Date(a.pirAt ?? a.updatedAt).getTime());

  return (
    <>
      <PageHeader
        title="Release notes & comms"
        subtitle="User-communication broadcasts published on each successful release."
        back="/change"
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="📣" iconBg="#eef2ff" label="Published releases" value={released.length.toLocaleString("en-IN")} />
      </StatGrid>

      {released.length === 0 ? (
        <div className="card">
          <EmptyState icon="📣" title="No release notes published yet" message="Completing a change with release notes broadcasts them to users via the notification service." />
        </div>
      ) : (
        released.map((c) => (
          <div className="card" key={c.id}>
            <div className="card-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3><a href={`/change/${c.id}`}>{c.title}</a></h3>
              <span style={{ color: "#667085", fontSize: 13 }}>{formatIndianDate(c.pirAt ?? c.updatedAt)}</span>
            </div>
            <div className="pad">
              <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{c.releaseNotes}</p>
              {c.affectedServices.length > 0 && (
                <p style={{ color: "#667085", fontSize: 13, marginTop: 8 }}>
                  Affected services: {c.affectedServices.join(", ")}
                </p>
              )}
            </div>
          </div>
        ))
      )}
    </>
  );
}
