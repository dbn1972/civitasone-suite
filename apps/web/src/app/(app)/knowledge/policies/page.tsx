import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { getKnowledgePolicies, getReviewDuePolicies } from "../_data/loaders";
import { formatIndianDate, todayIST } from "@/lib/formatters";
import { getTranslations } from "next-intl/server";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { policyStatusLabel } from "../_data/statusLabels";
import { PoliciesTable } from "./PoliciesTable";
import type { PolicySummary } from "../_data/types";

const AUTHOR_ROLES = ["knowledge_user", "knowledge_admin", "super_admin"];

type Row = {
  id: string;
  reference: string;
  title: string;
  docType: string;
  status: string;
  rawStatus: string;
  effectiveDate: string;
  reviewDue: string;
  reviewOverdue: boolean;
  version: string;
};

function toRow(p: PolicySummary): Row {
  const today = todayIST();
  const reviewOverdue =
    p.status === "published" && p.reviewDueDate != null && p.reviewDueDate < today;
  return {
    id: p.id,
    reference: p.referenceNo ?? "Unassigned",
    title: p.title,
    docType: p.docType.toUpperCase(),
    status: policyStatusLabel(p.status),
    rawStatus: p.status,
    effectiveDate: p.effectiveDate ? formatIndianDate(p.effectiveDate) : "—",
    reviewDue: p.reviewDueDate ? formatIndianDate(p.reviewDueDate) : "—",
    reviewOverdue,
    version: `v${p.version}`,
  };
}

export default async function Page(props: { searchParams?: Promise<{ filter?: string }> }) {
  const searchParams = await props.searchParams;
  const [{ data: policies, source }, { data: reviewDue, source: reviewDueSource }] = await Promise.all([
    getKnowledgePolicies(),
    getReviewDuePolicies(),
  ]);
  const t = await getTranslations("knowledgeW2");
  const errored = source === "error";
  const filterReviewDue = searchParams?.filter === "review-due";
  const canCreate = AUTHOR_ROLES.some((r) => getSessionRoles().includes(r));

  const published = errored ? 0 : policies.filter((p) => p.status === "published").length;
  const inReview = errored ? 0 : policies.filter((p) => p.status === "under_review" || p.status === "approved").length;
  const visible = filterReviewDue ? reviewDue : policies;
  const rows = visible.map(toRow);

  return (
    <>
      <PageHeader
        title="SOPs, Policies & Circulars"
        subtitle="Governed document lifecycle — draft, maker-checker approval, publish, acknowledge and periodic review."
        back="/knowledge"
        actions={canCreate ? <Link href="/knowledge/policies/new" className="btn primary" style={{ minHeight: 44 }}>+ New</Link> : undefined}
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="📘" tone="info" label="Total documents" value={errored ? "—" : policies.length.toLocaleString("en-IN")} />
        <StatCard icon="✅" tone="good" label="Published" value={errored ? "—" : published.toLocaleString("en-IN")} />
        <StatCard icon="🕓" tone="warn" label="In review / approved" value={errored ? "—" : inReview.toLocaleString("en-IN")} />
        <StatCard
          icon="🔁"
          tone="bad"
          label="Review due"
          value={reviewDueSource === "error" ? "—" : reviewDue.length.toLocaleString("en-IN")}
          href="/knowledge/policies?filter=review-due"
        />
      </StatGrid>
      <div className="card">
        <div className="card-h">
          <h3>{filterReviewDue ? "Documents due for review" : "All governed documents"}</h3>
        </div>
        {errored ? (
          <RefreshErrorState error={toHumanError("load", { area: "governed documents" })} backHref="/knowledge" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="📘"
            title={filterReviewDue ? "Nothing is due for review" : "No governed documents yet"}
            message={filterReviewDue ? "No published document has reached its periodic review date." : "Create a SOP, policy or circular to begin the lifecycle."}
            action={!filterReviewDue && canCreate ? <Link href="/knowledge/policies/new" className="btn primary" style={{ minHeight: 44 }}>{t("createFirst")}</Link> : undefined}
          />
        ) : (
          <PoliciesTable rows={rows} />
        )}
      </div>
    </>
  );
}
