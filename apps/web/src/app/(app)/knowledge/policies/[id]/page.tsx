import { notFound } from "next/navigation";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid, EmptyState } from "../../../../_components/ds";
import { getKnowledgePolicy, getPolicyAcknowledgements } from "../../_data/loaders";
import { formatIndianDate } from "@/lib/formatters";
import { PolicyActions } from "./PolicyActions";

export default async function Page({ params }: { params: { id: string } }) {
  const { data: policy, source } = await getKnowledgePolicy(params.id);
  if (!policy && source !== "error") notFound();
  if (!policy) {
    return (
      <>
        <PageHeader title="Document" subtitle="Governed document detail." back="/knowledge/policies" />
        <DataSourceBadge source="error" />
        <EmptyState icon="⚠️" title="Could not load document" message="The knowledge service is unavailable." />
      </>
    );
  }

  const { data: acks } = await getPolicyAcknowledgements(params.id);
  const isPublished = policy.status === "published";

  return (
    <>
      <PageHeader
        title={policy.title}
        subtitle={`${policy.docType.toUpperCase()} · ${policy.referenceNo ?? policy.id.slice(0, 8).toUpperCase()} · v${policy.version}`}
        back="/knowledge/policies"
      />
      <StatGrid>
        <StatCard icon="🚦" iconBg="#eef2ff" label="Status" value={policy.status.replace(/_/g, " ")} />
        <StatCard icon="📅" iconBg="#ecfdf5" label="Effective" value={policy.effectiveDate ? formatIndianDate(policy.effectiveDate) : "—"} />
        <StatCard icon="🔁" iconBg="#fffbeb" label="Review due" value={policy.reviewDueDate ? formatIndianDate(policy.reviewDueDate) : "—"} />
        <StatCard icon="👥" iconBg="#f0f9ff" label="Acknowledged" value={acks.acknowledgedCount.toLocaleString("en-IN")} />
      </StatGrid>

      <div className="card">
        <div className="card-h"><h3>Document body</h3></div>
        <div className="pad" style={{ whiteSpace: "pre-wrap", lineHeight: 1.6, color: "var(--ink2, #475569)" }}>
          {policy.body || "No content."}
        </div>
      </div>

      <PolicyActions policyId={policy.id} status={policy.status} />

      <div className="card">
        <div className="card-h"><h3>Who has acknowledged ({acks.acknowledgedCount})</h3></div>
        {acks.employeeIds.length === 0 ? (
          <EmptyState
            icon={isPublished ? "🕓" : "🔒"}
            title={isPublished ? "No acknowledgements yet" : "Not open for acknowledgement"}
            message={isPublished ? "Employees have not yet marked this document as read & understood." : "Acknowledgement opens once the document is published."}
          />
        ) : (
          <ul className="pad" style={{ margin: 0, paddingLeft: 28 }}>
            {acks.employeeIds.map((eid) => (
              <li key={eid} style={{ fontFamily: "monospace", fontSize: 13, padding: "3px 0" }}>{eid}</li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
