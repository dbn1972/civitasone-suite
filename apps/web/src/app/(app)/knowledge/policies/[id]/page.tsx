import Link from "next/link";
import { notFound } from "next/navigation";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid, EmptyState, RefreshErrorState } from "../../../../_components/ds";
import { getKnowledgePolicy, getPolicyAcknowledgements } from "../../_data/loaders";
import { formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { policyStatusLabel } from "../../_data/statusLabels";
import { getSessionUserId, getSessionRoles } from "@/lib/auth/roleGuard";
import { PolicyActions } from "./PolicyActions";

const POLICY_ADMIN_ROLES = ["knowledge_admin", "super_admin", "hr_admin"];

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

  const { data: acks, source: acksSource } = await getPolicyAcknowledgements(params.id);
  const acksErrored = acksSource === "error";
  const isPublished = policy.status === "published";

  const currentUserId = getSessionUserId();
  const sessionRoles = getSessionRoles();
  const isAdmin = POLICY_ADMIN_ROLES.some((r) => sessionRoles.includes(r));
  const alreadyAcknowledged = currentUserId
    ? acks.employeeIds.includes(currentUserId)
    : false;

  return (
    <>
      <PageHeader
        title={policy.title}
        subtitle={`${policy.docType.toUpperCase()} · ${policy.referenceNo ?? "Unassigned"} · v${policy.version}`}
        back="/knowledge/policies"
      />
      <StatGrid>
        <StatCard
          icon="🚦"
          iconBg="#eef2ff"
          label="Status"
          value={policyStatusLabel(policy.status)}
        />
        <StatCard icon="📅" iconBg="#ecfdf5" label="Effective" value={policy.effectiveDate ? formatIndianDate(policy.effectiveDate) : "—"} />
        <StatCard icon="🔁" iconBg="#fffbeb" label="Review due" value={policy.reviewDueDate ? formatIndianDate(policy.reviewDueDate) : "—"} />
        <StatCard icon="👥" iconBg="#f0f9ff" label="Acknowledged" value={acksErrored ? "—" : acks.acknowledgedCount.toLocaleString("en-IN")} />
      </StatGrid>

      <div className="card">
        <div className="card-h"><h3>Document body</h3></div>
        <div className="pad" style={{ whiteSpace: "pre-wrap", lineHeight: 1.6, color: "var(--ink2, #475569)" }}>
          {policy.body || "No content."}
        </div>
      </div>

      {/* GAP-KNOWLEDGE-POLICIES-DETAIL-07: supersedes link */}
      {policy.supersedesId && (
        <div className="card">
          <div className="card-h"><h3>Supersedes</h3></div>
          <div className="pad">
            <Link href={`/knowledge/policies/${policy.supersedesId}`} style={{ textDecoration: "underline" }}>
              View superseded version
            </Link>
          </div>
        </div>
      )}

      <PolicyActions
        policyId={policy.id}
        status={policy.status}
        authorId={policy.authorId}
        currentUserId={currentUserId}
        alreadyAcknowledged={alreadyAcknowledged}
        isAdmin={isAdmin}
      />

      <div className="card">
        <div className="card-h"><h3>Who has acknowledged ({acksErrored ? "—" : acks.acknowledgedCount})</h3></div>
        {acksErrored ? (
          <RefreshErrorState error={toHumanError("load", { area: "acknowledgements" })} />
        ) : acks.employeeIds.length === 0 ? (
          <EmptyState
            icon={isPublished ? "🕓" : "🔒"}
            title={isPublished ? "No acknowledgements yet" : "Not open for acknowledgement"}
            message={isPublished ? "Employees have not yet marked this document as read & understood." : "Acknowledgement opens once the document is published."}
          />
        ) : isAdmin ? (
          <div className="pad">
            <p style={{ fontSize: 14, color: "var(--mut)", marginBottom: 8 }}>
              {acks.acknowledgedCount} employee{acks.acknowledgedCount !== 1 ? "s" : ""} acknowledged.
              Employee names will be resolved when the HR lookup integration is available.
            </p>
          </div>
        ) : (
          <div className="pad">
            <p style={{ fontSize: 14, color: "var(--mut)" }}>
              {acks.acknowledgedCount} employee{acks.acknowledgedCount !== 1 ? "s have" : " has"} acknowledged this document.
            </p>
          </div>
        )}
      </div>
    </>
  );
}
