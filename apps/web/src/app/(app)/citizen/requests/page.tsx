import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid, StatusPill, EmptyState } from "../../../_components/ds";
import { getCitizenRequests } from "../../../_data/loaders";

export default async function Page() {
  const { data: requests, source } = await getCitizenRequests();

  const open = requests.filter((r) => r.status === "submitted" || r.status === "under_review" || r.status === "in_progress").length;
  const resolved = requests.filter((r) => r.status === "resolved").length;
  const rejected = requests.filter((r) => r.status === "rejected").length;

  return (
    <>
      <PageHeader
        title="Citizen Service Requests"
        subtitle="Grievances and service requests with SLA &amp; routing."
        actions={
          <>
            <button className="btn ghost">Categories</button>
            <button className="btn primary">+ Log Request</button>
          </>
        }
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="📨" iconBg="#e0f5fa" label="Open" value={open.toLocaleString("en-IN")} />
        <StatCard icon="🔴" iconBg="#fef3f2" label="Rejected" value={rejected.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Resolved (MTD)" value={resolved.toLocaleString("en-IN")} />
        <StatCard icon="😊" iconBg="#fffaeb" label="Total" value={requests.length.toLocaleString("en-IN")} />
      </StatGrid>
      <div className="card">
        <div className="card-h">
          <h3>Grievances &amp; service requests</h3>
          <div className="seg">
            <span className="on">All</span>
            <span>Grievance</span>
            <span>Service</span>
            <span>Breached</span>
          </div>
        </div>
        {requests.length === 0 ? (
          <EmptyState icon="📨" title="No service requests" message="Citizen requests will appear here once submitted." />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Request No</th>
                <th>Citizen Name</th>
                <th>Service Type</th>
                <th>Submitted</th>
                <th>Phone</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td><span style={{ fontFamily: "monospace" }}>{r.requestNo}</span></td>
                  <td>{r.citizenName}</td>
                  <td>{r.serviceType}</td>
                  <td>{r.submittedAt.slice(0, 10)}</td>
                  <td>{r.citizenPhone ?? "—"}</td>
                  <td><StatusPill status={r.status} label={r.status.replace(/_/g, " ")} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
