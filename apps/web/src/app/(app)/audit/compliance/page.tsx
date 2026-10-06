import { PageHeader, StatCard, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { getAuditCompliance } from "../../../_data/loaders";
import { toResourceState } from "../../../_data/useResource";
import { toHumanError } from "@/lib/messages";
import { AuditBreadcrumb } from "../_components/AuditBreadcrumb";
import { GenerateReportButton } from "./GenerateReportButton";
import { ComplianceTable } from "./ComplianceTable";
import { complianceCounts, partitionCompliance } from "./complianceModel";

type ComplianceRow = {
  id: string;
  lawOrRule: string;
  section?: string;
  requirement: string;
  dueDate: string;
  department?: string;
  status: string;
} & Record<string, unknown>;

export default async function AuditCompliancePage() {
  const result = await getAuditCompliance();
  const { data: items } = result;
  const resource = toResourceState(result);
  const errored = resource.status === "error";

  const counts = complianceCounts(items);
  const { dpdp, regulatory, other } = partitionCompliance(items);

  // GAP-AUDIT-COMPLIANCE-01: a regulatory screen must never assert "Compliant"
  // on an outage or an empty tenant. Only claim compliance when there is real,
  // actionable data (actionable > 0) and nothing is overdue; otherwise show a
  // non-committal "No data"/"—". On a fetch error every KPI reads "—".
  const scoreValue = errored || counts.scorePct === null ? null : `${counts.scorePct}%`;
  const compliedValue = errored ? null : `${counts.complied} / ${counts.actionable}`;
  const certInValue = errored
    ? null
    : counts.actionable === 0
      ? "No data"
      : counts.overdue === 0
        ? "Compliant"
        : "Review";
  const openActionsValue = errored ? null : counts.openActions;

  // GAP-AUDIT-COMPLIANCE-03: regulatory card shows regulatory matches plus the
  // unmatched "other" bucket (so nothing is hidden), never a duplicated slice.
  const displayDpdp = dpdp as ComplianceRow[];
  const displayCert = [...regulatory, ...other] as ComplianceRow[];

  return (
    <div className="wrap">
      <AuditBreadcrumb current="Compliance" />
      <PageHeader
        title="Compliance — DPDP & CERT-In"
        subtitle="Data-protection (DPDP Act), CERT-In directions & security-policy posture."
        actions={<GenerateReportButton items={items} />}
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="📜" iconBg="var(--infobg)" label="Compliance Score" value={scoreValue} hint="Share of actionable requirements that are complied (excludes planned / N-A)." />
        <StatCard icon="🔏" iconBg="#e6f7f0" label="Controls Complied" value={compliedValue} />
        {/* GAP-AUDIT-COMPLIANCE-04: no hard-coded "6-hr reporting" delta — that
            was static copy, not data. The overdue count is a real figure. */}
        <StatCard icon="🛡️" iconBg="var(--infobg)" label="CERT-In Directions" value={certInValue} />
        <StatCard icon="⏳" iconBg="var(--warnbg)" label="Open Actions" value={openActionsValue} hint="Requirements still pending or overdue." />
      </div>
      {errored ? (
        <RefreshErrorState error={toHumanError("load", { area: "compliance requirements" })} />
      ) : (
        <div className="grid g-2">
          <div className="card">
            <div className="card-h"><h3>DPDP Act requirements</h3></div>
            {displayDpdp.length === 0 ? (
              <EmptyState icon="📜" title="No items" message="DPDP Act requirements will appear here once configured." />
            ) : (
              <ComplianceTable items={displayDpdp} variant="dpdp" />
            )}
          </div>
          <div className="card">
            <div className="card-h"><h3>Regulatory &amp; govt policy</h3></div>
            {displayCert.length === 0 ? (
              <EmptyState icon="📋" title="No items" message="Regulatory requirements will appear here once configured." />
            ) : (
              <ComplianceTable items={displayCert} variant="cert" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
