import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getKnowledgeDocs } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, StatusPill } from "../../../_components/ds";

export default async function KnowledgeRepositoryPage() {
  const { data: docs, source } = await getKnowledgeDocs();

  const total = docs.length;
  const approved = docs.filter((d) => d.status === "approved").length;
  const pendingReview = docs.filter((d) => d.status === "under_review").length;
  const archived = docs.filter((d) => d.status === "archived").length;

  function statusLabel(s: string) {
    if (s === "approved") return "Published";
    if (s === "under_review") return "Draft";
    if (s === "archived") return "Archived";
    return s;
  }

  function statusPillStatus(s: string) {
    if (s === "approved") return "approved";
    if (s === "under_review") return "pending";
    if (s === "draft") return "draft";
    return "mut";
  }

  return (
    <div className="wrap">
      {source === "error" && <DataSourceBadge source={source} />}
      <PageHeader
        title="Digital Repository"
        subtitle="Circulars, policies &amp; notifications with versioning."
        actions={
          <>
            <button className="btn ghost">Import</button>
            <Link href="/knowledge/documents/new" className="btn primary">+ Publish Document</Link>
          </>
        }
      />

      <StatGrid>
        <StatCard icon="📂" iconBg="#fef9e7" label="Documents" value={total.toLocaleString("en-IN")} />
        <StatCard icon="📜" iconBg="#eff6ff" label="Circulars" value={approved.toLocaleString("en-IN")} />
        <StatCard icon="📘" iconBg="#ecfdf3" label="Published" value={approved.toLocaleString("en-IN")} />
        <StatCard icon="📢" iconBg="#fffaeb" label="Notifications" value={pendingReview.toLocaleString("en-IN")} />
      </StatGrid>

      <div className="card" style={{ marginTop: "18px" }}>
        <div className="card-h">
          <h3>Digital repository</h3>
          <div className="seg">
            <span className="on">All</span>
            <span>Circulars</span>
            <span>Policies</span>
            <span>Notifications</span>
          </div>
        </div>
        {docs.length === 0 ? (
          <div className="empty-state">
            <div className="ic">📂</div>
            <h4>No documents found</h4>
            <p>No documents found in the repository.</p>
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Doc ID</th>
                <th>Title</th>
                <th>Type</th>
                <th>Dept</th>
                <th>Version</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => (
                <tr key={doc.id} className="clickable">
                  <td><span className="mono">{doc.id.slice(0, 8).toUpperCase()}</span></td>
                  <td>{doc.title}</td>
                  <td>{doc.category}</td>
                  <td>{doc.author ?? "—"}</td>
                  <td>{doc.version}</td>
                  <td>
                    <StatusPill status={statusPillStatus(doc.status)} label={statusLabel(doc.status)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {archived > 0 && (
          <div style={{ padding: "8px 16px", fontSize: "12px", color: "#98a2b3" }}>
            {archived} archived document{archived !== 1 ? "s" : ""} not shown
          </div>
        )}
      </div>
    </div>
  );
}
