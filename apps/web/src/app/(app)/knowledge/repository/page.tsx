import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getKnowledgeDocs } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { RepositoryClient } from "./RepositoryClient";
import { ImportButton } from "./ImportButton";

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

  type DocRow = {
    id: string;
    title: string;
    category: string;
    author: string;
    version: string;
    statusLabel: string;
    statusPill: string;
    rawCategory: string;
  };

  const rows: DocRow[] = docs.map((doc) => ({
    id: doc.id.slice(0, 8).toUpperCase(),
    title: doc.title,
    category: doc.category,
    author: doc.author ?? "—",
    version: doc.version ?? "—",
    statusLabel: statusLabel(doc.status),
    statusPill: statusPillStatus(doc.status),
    rawCategory: doc.category,
  }));

  return (
    <div className="wrap">
      {source === "error" && <DataSourceBadge source={source} />}
      <PageHeader
        title="Digital Repository"
        subtitle="Circulars, policies &amp; notifications with versioning."
        actions={
          <>
            <ImportButton />
            <Link href="/knowledge/documents/new" className="btn primary" style={{ minHeight: 44 }}>+ Publish Document</Link>
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
        </div>
        <RepositoryClient rows={rows} />
        {archived > 0 && (
          <div style={{ padding: "8px 16px", fontSize: "12px", color: "#98a2b3" }}>
            {archived} archived document{archived !== 1 ? "s" : ""} not shown
          </div>
        )}
      </div>
    </div>
  );
}
