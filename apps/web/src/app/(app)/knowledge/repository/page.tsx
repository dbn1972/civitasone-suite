import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getKnowledgeDocs } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, RefreshErrorState, EmptyState } from "../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import { knowledgeDocStatusLabel, knowledgeDocStatusPill, categorySegment } from "../_data/statusLabels";
import { RepositoryClient } from "./RepositoryClient";
import { ImportButton } from "./ImportButton";

export type DocRow = {
  id: string;
  fullId: string;
  title: string;
  category: string;
  author: string;
  version: string;
  statusLabel: string;
  statusPill: string;
  rawCategory: string;
  segment: string;
};

export default async function KnowledgeRepositoryPage() {
  const { data: docs, source } = await getKnowledgeDocs();
  const errored = source === "error";

  // GAP-KNOWLEDGE-REPOSITORY-03: filter out archived by default
  const visible = docs.filter((d) => d.status !== "archived");
  const archived = docs.length - visible.length;

  // GAP-KNOWLEDGE-REPOSITORY-01: stat counts by category segment, not by status
  const circularsCount = errored ? 0 : visible.filter((d) => categorySegment(d.category) === "Circulars").length;
  const published = errored ? 0 : visible.filter((d) => d.status === "approved").length;
  const notificationsCount = errored ? 0 : visible.filter((d) => categorySegment(d.category) === "Notifications").length;

  const rows: DocRow[] = visible.map((doc) => ({
    id: doc.id.slice(0, 8).toUpperCase(),
    fullId: doc.id,
    title: doc.title,
    category: doc.category,
    author: doc.author ?? "—",
    version: doc.version ?? "—",
    statusLabel: knowledgeDocStatusLabel(doc.status),
    statusPill: knowledgeDocStatusPill(doc.status),
    rawCategory: doc.category,
    segment: categorySegment(doc.category),
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
        <StatCard icon="📂" iconBg="#fef9e7" label="Documents" value={errored ? "—" : visible.length.toLocaleString("en-IN")} />
        <StatCard icon="📜" iconBg="#eff6ff" label="Circulars" value={errored ? "—" : circularsCount.toLocaleString("en-IN")} />
        <StatCard icon="📘" iconBg="#ecfdf3" label="Published" value={errored ? "—" : published.toLocaleString("en-IN")} />
        <StatCard icon="📢" iconBg="#fffaeb" label="Notifications" value={errored ? "—" : notificationsCount.toLocaleString("en-IN")} />
      </StatGrid>

      <div className="card" style={{ marginTop: "18px" }}>
        <div className="card-h">
          <h3>Digital repository</h3>
        </div>
        {errored ? (
          <RefreshErrorState error={toHumanError("load", { area: "documents" })} backHref="/knowledge" />
        ) : rows.length === 0 ? (
          <EmptyState icon="📂" title="No documents found" message="No documents found in the repository." />
        ) : (
          <RepositoryClient rows={rows} />
        )}
        {archived > 0 && !errored && (
          <div style={{ padding: "8px 16px", fontSize: "12px", color: "var(--mut)" }}>
            {archived} archived document{archived !== 1 ? "s" : ""} hidden from this view.
          </div>
        )}
      </div>
    </div>
  );
}
