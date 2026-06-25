import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getKnowledgeDocs } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, StatusPill } from "../../../_components/ds";

export default async function KnowledgeListPage() {
  const { data: docs, source } = await getKnowledgeDocs();

  const total = docs.length;
  const approved = docs.filter((d) => d.status === "approved").length;
  const pendingReview = docs.filter((d) => d.status === "under_review").length;
  const categories = new Set(docs.map((d) => d.category)).size;

  function statusLabel(s: string) {
    if (s === "approved") return "Published";
    if (s === "under_review") return "Under review";
    if (s === "draft") return "Draft";
    if (s === "archived") return "Archived";
    return s;
  }

  function statusPillStatus(s: string) {
    if (s === "approved") return "approved";
    if (s === "under_review") return "pending";
    return "mut";
  }

  return (
    <div className="wrap">
      {source === "error" && <DataSourceBadge source={source} />}
      <PageHeader
        title="Knowledge — Documents"
        subtitle="All documents in the knowledge base."
        actions={
          <>
            <button className="btn ghost">Import</button>
            <Link href="/knowledge/documents/new" className="btn primary">+ New Document</Link>
          </>
        }
      />

      <StatGrid>
        <StatCard icon="📂" iconBg="#fef9e7" label="Total Documents" value={total.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Published" value={approved.toLocaleString("en-IN")} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Under Review" value={pendingReview.toLocaleString("en-IN")} />
        <StatCard icon="🏷️" iconBg="#eff6ff" label="Categories" value={categories.toLocaleString("en-IN")} />
      </StatGrid>

      <div className="card" style={{ marginTop: "18px" }}>
        <div className="card-h"><h3>Documents</h3></div>
        {docs.length === 0 ? (
          <div className="empty-state">
            <div className="ic">📂</div>
            <h4>No documents found</h4>
            <p>No documents found in the knowledge base.</p>
          </div>
        ) : (
          <table className="tbl" aria-label="Knowledge documents">
            <thead>
              <tr>
                <th>Doc ID</th>
                <th>Title</th>
                <th>Category</th>
                <th>Author</th>
                <th>Version</th>
                <th>Access</th>
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
                  <td>{doc.version ?? "—"}</td>
                  <td>{doc.accessLevel}</td>
                  <td>
                    <StatusPill status={statusPillStatus(doc.status)} label={statusLabel(doc.status)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
