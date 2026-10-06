import { notFound } from "next/navigation";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid, EmptyState, StatusPill } from "../../../../_components/ds";
import { getKnowledgeDocument } from "../../_data/loaders";
import { formatIndianDate } from "@/lib/formatters";
import { knowledgeDocStatusLabel } from "../../_data/statusLabels";

/**
 * GAP-KNOWLEDGE-LIST-01: generic document detail route. Previously no detail
 * page existed under /knowledge/documents — rows in the list were dead ends.
 * This page fetches GET /v1/knowledge/articles/:id and shows metadata, status,
 * access level and creation date.
 *
 * GAP-KNOWLEDGE-LIST-06: access level is displayed with a lock icon for
 * restricted/confidential documents and a neutral pill otherwise.
 */

function accessLevelPill(level: string) {
  const lc = level.toLowerCase();
  const label = level.charAt(0).toUpperCase() + level.slice(1);
  if (lc === "restricted" || lc === "confidential") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <span aria-hidden="true">🔒</span>
        <StatusPill status="rejected" label={label} />
      </span>
    );
  }
  return <StatusPill status={lc === "public" ? "active" : "info"} label={label} />;
}

export default async function Page({ params }: { params: { id: string } }) {
  const { data: doc, source } = await getKnowledgeDocument(params.id);
  if (!doc && source !== "error") notFound();
  if (!doc) {
    return (
      <>
        <PageHeader title="Document" subtitle="Knowledge document detail." back="/knowledge/repository" />
        <DataSourceBadge source="error" />
        <EmptyState icon="⚠️" title="Could not load document" message="The knowledge service is unavailable." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={doc.title}
        subtitle={`${doc.category ?? "Uncategorised"} · v${doc.version}`}
        back="/knowledge/repository"
      />
      <StatGrid>
        <StatCard
          icon="🚦"
          iconBg="#eef2ff"
          label="Status"
          value={knowledgeDocStatusLabel(doc.status)}
        />
        <StatCard icon="📅" iconBg="#ecfdf5" label="Created" value={formatIndianDate(doc.createdAt)} />
        <StatCard icon="📎" iconBg="#fffbeb" label="File type" value={doc.fileType ?? "—"} />
        <StatCard icon="📏" iconBg="#f0f9ff" label="File size" value={doc.fileSize ? `${(doc.fileSize / 1024).toFixed(1)} KB` : "—"} />
      </StatGrid>

      <div className="card">
        <div className="card-h"><h3>Details</h3></div>
        <div className="pad" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--mut)", marginBottom: 4, textTransform: "uppercase" }}>Author</div>
            <div style={{ fontSize: 14, color: "var(--ink)" }}>{doc.author ?? "—"}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--mut)", marginBottom: 4, textTransform: "uppercase" }}>Category</div>
            <div style={{ fontSize: 14, color: "var(--ink)" }}>{doc.category ?? "—"}</div>
          </div>
          <div>
            {/* GAP-KNOWLEDGE-LIST-06: access level pill with lock for restricted */}
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--mut)", marginBottom: 4, textTransform: "uppercase" }}>Access level</div>
            <div>{accessLevelPill(doc.accessLevel)}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--mut)", marginBottom: 4, textTransform: "uppercase" }}>Version</div>
            <div style={{ fontSize: 14, color: "var(--ink)" }}>{doc.version}</div>
          </div>
        </div>
      </div>

      {doc.tags.length > 0 && (
        <div className="card">
          <div className="card-h"><h3>Tags</h3></div>
          <div className="pad" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {doc.tags.map((t) => (
              <span key={t} className="chip">{t}</span>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
