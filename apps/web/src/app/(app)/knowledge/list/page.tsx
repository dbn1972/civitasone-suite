import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getKnowledgeDocs } from "../../../_data/loaders";
import { DataTable, EmptyState, PageHeader, StatCard, StatGrid, StatusPill } from "../../../_components/ds";
import { ImportButton } from "./ImportButton";

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

  type DocRow = {
    id: string;
    title: string;
    category: string;
    author: string;
    version: string;
    accessLevel: string;
    statusLabel: string;
    statusPill: string;
  };

  const rows: DocRow[] = docs.map((doc) => ({
    id: doc.id.slice(0, 8).toUpperCase(),
    title: doc.title,
    category: doc.category,
    author: doc.author ?? "—",
    version: doc.version ?? "—",
    accessLevel: doc.accessLevel,
    statusLabel: statusLabel(doc.status),
    statusPill: statusPillStatus(doc.status),
  }));

  return (
    <div className="wrap">
      {source === "error" && <DataSourceBadge source={source} />}
      <PageHeader
        title="Knowledge — Documents"
        subtitle="All documents in the knowledge base."
        actions={
          <>
            <ImportButton />
            <Link href="/knowledge/documents/new" className="btn primary" style={{ minHeight: 44 }}>+ New Document</Link>
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
          <EmptyState icon="📂" title="No documents found" message="No documents found in the knowledge base." />
        ) : (
          <DataTable<DocRow>
            columns={[
              { key: "id", label: "Doc ID" },
              { key: "title", label: "Title" },
              { key: "category", label: "Category" },
              { key: "author", label: "Author" },
              { key: "version", label: "Version" },
              { key: "accessLevel", label: "Access" },
              {
                key: "statusLabel",
                label: "Status",
                render: (row) => <StatusPill status={row.statusPill} label={row.statusLabel} />,
              },
            ]}
            rows={rows}
            sortable
            filterable
            pageSize={15}
          />
        )}
      </div>
    </div>
  );
}
