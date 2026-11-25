import { PageHeader, Card, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { getInvestigationDetail } from "@/app/_data/loaders";
import { getSessionRoles, hasAnyRole, AUDIT_INVESTIGATION_DETAIL_ROLES } from "@/lib/auth/roleGuard";
import { toHumanError } from "@/lib/messages";
import { formatIndianDate } from "@/lib/formatters";
import { InvestigationActions } from "../InvestigationActions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS: Record<string, string> = { in_progress: "In progress", findings_submitted: "Findings submitted", closed: "Closed" };
const OUTCOME: Record<string, string> = { substantiated: "Substantiated", unsubstantiated: "Unsubstantiated", inconclusive: "Inconclusive", referred: "Referred onward" };

// GAP-AUDIT-INVESTIGATION-05: case detail. Subject/findings are only fetched for the roles the audit-service
// route allows (owner decision B4); any other role sees an access notice and no case data is requested.
export default async function InvestigationDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const allowed = hasAnyRole(getSessionRoles(), AUDIT_INVESTIGATION_DETAIL_ROLES);
  if (!allowed) {
    return (
      <div className="page-main wrap">
        <PageHeader title="Investigation" back="/audit/investigation" />
        <Card title="Restricted"><EmptyState icon="🔒" title="Access restricted" message="Investigation case details are limited to audit administrators, audit officers and vigilance administrators." /></Card>
      </div>
    );
  }
  if (!UUID.test(id)) {
    return (
      <div className="page-main wrap">
        <PageHeader title="Investigation" back="/audit/investigation" />
        <Card title="Not found"><EmptyState icon="🕵️" title="Investigation not found" message="This case does not exist or you cannot see it." /></Card>
      </div>
    );
  }
  const res = await getInvestigationDetail(id);
  if (res.status === 404) {
    return (
      <div className="page-main wrap">
        <PageHeader title="Investigation" back="/audit/investigation" />
        <Card title="Not found"><EmptyState icon="🕵️" title="Investigation not found" message="This case does not exist or you cannot see it." /></Card>
      </div>
    );
  }
  if (res.source === "error" || !res.data) {
    return (
      <div className="page-main wrap">
        <PageHeader title="Investigation" back="/audit/investigation" />
        <Card title="Investigation"><div className="pad"><RefreshErrorState error={toHumanError("load", { area: "investigation case" })} backHref="/audit/investigation" /></div></Card>
      </div>
    );
  }
  const inv = res.data;
  return (
    <div className="page-main wrap">
      <PageHeader
        title={`Investigation ${inv.caseId}`}
        subtitle={STATUS[inv.status] ?? inv.status}
        back="/audit/investigation"
        actions={<InvestigationActions id={inv.id} caseId={inv.caseId} status={inv.status} />}
      />
      <Card title="Case">
        <dl className="pad" style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "8px 16px", margin: 0 }}>
          <dt>Subject</dt><dd style={{ margin: 0 }}>{inv.subject}</dd>
          <dt>Assigned to</dt><dd style={{ margin: 0 }}>{inv.assignedTo}</dd>
          <dt>Started</dt><dd style={{ margin: 0 }}>{inv.started ? formatIndianDate(inv.started) : "—"}</dd>
          <dt>Findings</dt><dd style={{ margin: 0, whiteSpace: "pre-wrap" }}>{inv.findings || "—"}</dd>
          {inv.status === "closed" ? (
            <>
              <dt>Outcome</dt><dd style={{ margin: 0 }}>{OUTCOME[inv.closeOutcome ?? ""] ?? inv.closeOutcome ?? "—"}</dd>
              <dt>Close reason</dt><dd style={{ margin: 0, whiteSpace: "pre-wrap" }}>{inv.closeReason ?? "—"}</dd>
              <dt>Closed on</dt><dd style={{ margin: 0 }}>{inv.closedAt ? formatIndianDate(inv.closedAt) : "—"}</dd>
            </>
          ) : null}
        </dl>
      </Card>
    </div>
  );
}
