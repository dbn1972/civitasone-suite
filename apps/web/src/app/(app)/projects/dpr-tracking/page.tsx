import { PageHeader, StatGrid, StatCard, Card, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { getProjectDprs } from "@/app/_data/loaders";
import { DprTrackingTable } from "./DprTrackingTable";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles, hasAnyRole, PROJECT_DPR_REVIEW_ROLES } from "@/lib/auth/roleGuard";

export default async function DprTrackingPage() {
  const result = await getProjectDprs();
  const { data: rows, source } = result;
  const resource = toResourceState(result);
  const errored = resource.status === "error";

  // GAP-PROJECTS-DPR-TRACKING-01: only offer the DPR review controls to roles
  // the server's transition route would accept (defence-in-depth; the server
  // stays the authority and 403s others).
  const canReview = hasAnyRole(getSessionRoles(), PROJECT_DPR_REVIEW_ROLES);

  const total = errored ? null : rows.length;
  const approved = errored ? null : rows.filter((r) => r.status === "approved").length;
  const underReview = errored ? null : rows.filter((r) => r.status === "under_review" || r.status === "under review" || r.status === "submitted").length;
  // GAP-PROJECTS-DPR-TRACKING-01: the DPR status machine is submitted →
  // under_review → approved | revision (project_dprs status CHECK). The
  // "returned to submitter" state is 'revision' — the previous pass counted
  // 'rejected', a value this backend never emits, so the Returned tile was
  // always 0. Count 'revision' and label the tile "Returned for revision" to
  // match the row pill's word for the same status.
  const returned = errored ? null : rows.filter((r) => r.status === "revision").length;

  return (
    <div className="page-main wrap">
      <PageHeader title="DPR Tracking" subtitle="Detailed Project Report submission, review and approval status." back="/projects" />
      <StatGrid>
        <StatCard icon="📄" iconBg="#eff6ff" label="Total DPRs" value={total ?? "—"} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Approved" value={approved ?? "—"} />
        <StatCard icon="🔍" iconBg="#fffaeb" label="Under Review" value={underReview ?? "—"} />
        <StatCard icon="↩️" iconBg="#fef3f2" label="Returned for revision" value={returned ?? "—"} />
      </StatGrid>
      <Card title="DPR Register">
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "DPRs" })} backHref="/projects" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon="📄" title="No DPRs" message="No Detailed Project Reports have been submitted yet." action={<a href="/projects/list" className="btn primary">View Projects</a>} />
        ) : (
          <DprTrackingTable rows={rows} source={source === "error" ? "error" : "api"} canReview={canReview} />
        )}
      </Card>
    </div>
  );
}
