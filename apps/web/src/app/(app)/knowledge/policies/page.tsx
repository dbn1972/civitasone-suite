import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid, DataTable, EmptyState } from "../../../_components/ds";
import { getKnowledgePolicies, getReviewDuePolicies } from "../_data/loaders";
import { formatIndianDate } from "@/lib/formatters";
import type { PolicySummary } from "../_data/types";

type Row = {
  id: string;
  reference: string;
  title: string;
  docType: string;
  status: string;
  effectiveDate: string;
  reviewDue: string;
  version: string;
};

function toRow(p: PolicySummary): Row {
  return {
    id: p.id,
    reference: p.referenceNo ?? p.id.slice(0, 8).toUpperCase(),
    title: p.title,
    docType: p.docType.toUpperCase(),
    status: p.status.replace(/_/g, " "),
    effectiveDate: p.effectiveDate ? formatIndianDate(p.effectiveDate) : "—",
    reviewDue: p.reviewDueDate ? formatIndianDate(p.reviewDueDate) : "—",
    version: `v${p.version}`,
  };
}

export default async function Page() {
  const [{ data: policies, source }, { data: reviewDue }] = await Promise.all([
    getKnowledgePolicies(),
    getReviewDuePolicies(),
  ]);

  const published = policies.filter((p) => p.status === "published").length;
  const inReview = policies.filter((p) => p.status === "under_review" || p.status === "approved").length;
  const rows = policies.map(toRow);

  return (
    <>
      <PageHeader
        title="SOPs, Policies & Circulars"
        subtitle="Governed document lifecycle — draft, maker-checker approval, publish, acknowledge and periodic review."
        back="/knowledge"
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="📘" iconBg="#eef2ff" label="Total documents" value={policies.length.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="#ecfdf5" label="Published" value={published.toLocaleString("en-IN")} />
        <StatCard icon="🕓" iconBg="#fffbeb" label="In review / approved" value={inReview.toLocaleString("en-IN")} />
        <StatCard icon="🔁" iconBg="#fef2f2" label="Review due" value={reviewDue.length.toLocaleString("en-IN")} />
      </StatGrid>
      <div className="card">
        <div className="card-h"><h3>All governed documents</h3></div>
        {rows.length === 0 ? (
          <EmptyState icon="📘" title="No governed documents yet" message="Create a SOP, policy or circular to begin the lifecycle." />
        ) : (
          <DataTable<Row>
            columns={[
              { key: "reference", label: "Reference" },
              { key: "title", label: "Title" },
              { key: "docType", label: "Type", cellType: "status" },
              { key: "status", label: "Status", cellType: "status" },
              { key: "effectiveDate", label: "Effective" },
              { key: "reviewDue", label: "Review due" },
              { key: "version", label: "Version" },
            ]}
            rows={rows}
            rowLinkKey="id"
            rowLinkPrefix="/knowledge/policies/"
            sortable
            filterable
            filterPlaceholder="Filter documents…"
            pageSize={15}
          />
        )}
      </div>
    </>
  );
}
