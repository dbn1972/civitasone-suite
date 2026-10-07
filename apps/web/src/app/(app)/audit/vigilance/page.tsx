import { PageHeader, StatGrid, StatCard, Card, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { getVigilanceCases } from "@/app/_data/loaders";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles, hasAnyRole } from "@/lib/auth/roleGuard";
import { VigilanceTable } from "./VigilanceTable";

// GAP-AUDIT-VIGILANCE-02 (DPDP): officer identity + charge text are disciplinary
// data. The audit-service GET /v1/audit/vigilance already restricts reads to
// these roles (services/audit-service/src/modules/vigilance/routes.ts
// READER_ROLES) and returns 403 to finance_admin/dept_head. Mirror that on the
// web as the SAFE DEFAULT so, even though the module layout still lets those
// roles open the page, the PII columns and the client-side CSV export are
// hidden/masked for anyone outside the vigilance reader set. A full
// click-to-reveal-with-audit-event flow needs a signed-off role matrix — see
// the HUMAN REVIEW note in the batch report.
const PII_ROLES = ["audit_officer", "audit_admin", "super_admin", "vigilance_officer"];

function maskName(name: string): string {
  const initials = name.split(/\s+/).filter(Boolean).map((p) => p[0]?.toUpperCase() ?? "").join("");
  return initials ? `${initials} ••••` : "••••";
}

export default async function VigilancePage() {
  const result = await getVigilanceCases();
  const { data: cases, source } = result;
  const resource = toResourceState(result);
  const errored = resource.status === "error";
  const canViewPII = hasAnyRole(getSessionRoles(), PII_ROLES);
  // Redact on the server so officer/charges never enter the RSC payload for
  // unprivileged roles (the table mask alone is cosmetic).
  const visibleCases = canViewPII ? cases : cases.map((c) => ({ ...c, officer: maskName(String(c.officer ?? "")), charges: "••••" }));

  const totalCases = errored ? null : cases.length;
  // GAP-AUDIT-VIGILANCE-03: derive every KPI bucket from one status->bucket
  // map so the cards always reconcile with Total Cases. charge_sheet_issued is
  // a valid stage (see VigilanceTable INQUIRY_LABELS) and previously fell into
  // no card, so the cards could sum to less than the total.
  const underInvestigation = errored
    ? null
    : cases.filter((c) => c.inquiryStatus === "under_investigation" || c.inquiryStatus === "preliminary_enquiry").length;
  const chargeSheeted = errored
    ? null
    : cases.filter((c) => c.inquiryStatus === "charge_sheet_issued").length;
  const inquiryComplete = errored ? null : cases.filter((c) => c.inquiryStatus === "inquiry_complete").length;
  const penaltiesImposed = errored
    ? null
    : cases.filter((c) => c.outcome === "major_penalty" || c.outcome === "minor_penalty").length;

  return (
    <div className="page-main wrap">
      <PageHeader
        title="Vigilance Cases"
        subtitle="Departmental vigilance proceedings and inquiry outcomes."
        back="/audit"
      />

      <StatGrid>
        <StatCard icon="🔍" iconBg="#eef2ff" label="Total Cases" value={totalCases ?? "—"} />
        <StatCard icon="⏳" iconBg="var(--goodbg)" label="Preliminary / Under Investigation" value={underInvestigation ?? "—"} />
        <StatCard icon="📑" iconBg="#fef3c7" label="Charge Sheet Issued" value={chargeSheeted ?? "—"} />
        <StatCard icon="📋" iconBg="var(--warnbg)" label="Inquiry Complete" value={inquiryComplete ?? "—"} />
        <StatCard icon="⚠️" iconBg="#fce7ee" label="Penalties Imposed" value={penaltiesImposed ?? "—"} />
      </StatGrid>

      {errored ? (
        <Card title="Vigilance Register">
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "vigilance cases" })} backHref="/audit" />
          </div>
        </Card>
      ) : cases.length === 0 ? (
        <Card title="Vigilance Register">
          <EmptyState
            icon="🔍"
            title="No vigilance cases found"
            message="Departmental vigilance cases will appear here once registered."
          />
        </Card>
      ) : (
        <Card title="Vigilance Register">
          <VigilanceTable rows={visibleCases} source={source} canViewPII={canViewPII} />
        </Card>
      )}
    </div>
  );
}
