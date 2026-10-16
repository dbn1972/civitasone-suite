import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid, EmptyState, RefreshErrorState } from "../../../../_components/ds";
import { getKnowledgePolicy, getPolicyAcknowledgements } from "../../_data/loaders";
import { formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { policyStatusLabel } from "../../_data/statusLabels";
import { getSessionUserId, getSessionRoles, KNOWLEDGE_POLICY_APPROVER_ROLES } from "@/lib/auth/roleGuard";
import { PolicyActions } from "./PolicyActions";

const POLICY_ADMIN_ROLES = ["knowledge_admin", "super_admin", "hr_admin"];

export default async function Page({ params }: { params: { id: string } }) {
  const { data: policy, source, status } = await getKnowledgePolicy(params.id);
  // SF-02: only a real 404 is "not found"; other failures render the error state below.
  if (source === "error" && status === 404) notFound();
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

  const t = await getTranslations("knowledgeW2.trail");
  const currentUserId = getSessionUserId();
  const sessionRoles = getSessionRoles();
  const isAdmin = POLICY_ADMIN_ROLES.some((r) => sessionRoles.includes(r));
  // GAP-KNOWLEDGE-POLICIES-DETAIL-02: approve/return/publish need an approver role (server-enforced).
  const canApprove = KNOWLEDGE_POLICY_APPROVER_ROLES.some((r) => sessionRoles.includes(r));
  const alreadyAcknowledged = currentUserId
    ? acks.employeeIds.includes(currentUserId)
    : false;

  // GAP-KNOWLEDGE-POLICIES-DETAIL-04: maker-checker evidence. The service only
  // returns identifiers (no names), so the trail says who it was relative to the
  // viewer ("You" / another user) rather than printing raw UUIDs.
  const person = (id: string | null) =>
    id == null || id === "" ? t("pending") : id === currentUserId ? t("you") : t("otherUser");
  const trail: Array<{ label: string; value: string }> = [
    { label: t("author"), value: person(policy.authorId) },
    { label: t("reviewer"), value: person(policy.reviewerId) },
    { label: t("approver"), value: person(policy.approverId) },
  ];
  const makerChecked = policy.approverId != null && policy.approverId !== "" && policy.approverId !== policy.authorId;

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
          tone="neutral"
          label="Status"
          value={policyStatusLabel(policy.status)}
        />
        <StatCard icon="📅" tone="good" label="Effective" value={policy.effectiveDate ? formatIndianDate(policy.effectiveDate) : "—"} />
        <StatCard icon="🔁" tone="warn" label="Review due" value={policy.reviewDueDate ? formatIndianDate(policy.reviewDueDate) : "—"} />
        <StatCard icon="👥" tone="neutral" label="Acknowledged" value={acksErrored ? "—" : acks.acknowledgedCount.toLocaleString("en-IN")} />
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

      <div className="card">
        <div className="card-h"><h3>{t("title")}</h3></div>
        <div className="pad">
          <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "6px 16px", margin: 0 }}>
            {trail.map((row) => (
              <div key={row.label} style={{ display: "contents" }}>
                <dt style={{ color: "var(--mut)", fontSize: 13 }}>{row.label}</dt>
                <dd style={{ margin: 0, fontSize: 14 }}>{row.value}</dd>
              </div>
            ))}
          </dl>
          {makerChecked && <p role="note" style={{ margin: "10px 0 0", fontSize: 13, color: "var(--mut)" }}>{t("distinct")}</p>}
          <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--mut)" }}>{t("namesNote")}</p>
        </div>
      </div>

      <PolicyActions
        policyId={policy.id}
        status={policy.status}
        authorId={policy.authorId}
        currentUserId={currentUserId}
        alreadyAcknowledged={alreadyAcknowledged}
        canApprove={canApprove}
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
