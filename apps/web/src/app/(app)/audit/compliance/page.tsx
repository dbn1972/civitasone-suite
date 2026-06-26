import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, EmptyState } from "../../../_components/ds";
import { getAuditCompliance } from "../../../_data/loaders";
import { GenerateReportButton } from "./GenerateReportButton";
import { ComplianceTable } from "./ComplianceTable";

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
  const { data: items, source } = await getAuditCompliance();

  const total = items.length;
  const complied = items.filter((i) => i.status === "complied").length;
  const pending = items.filter((i) => i.status === "pending").length;
  const overdue = items.filter((i) => i.status === "overdue").length;
  const score = total > 0 ? Math.round((complied / total) * 100) : 0;

  const dpdpItems = items.filter((i) => i.lawOrRule.toLowerCase().includes("dpdp") || i.lawOrRule.toLowerCase().includes("data"));
  const certItems = items.filter((i) => i.lawOrRule.toLowerCase().includes("cert") || i.lawOrRule.toLowerCase().includes("iso") || i.lawOrRule.toLowerCase().includes("ntp"));
  const displayDpdp: ComplianceRow[] = (dpdpItems.length > 0 ? dpdpItems : items.slice(0, Math.ceil(items.length / 2))) as ComplianceRow[];
  const displayCert: ComplianceRow[] = (certItems.length > 0 ? certItems : items.slice(Math.ceil(items.length / 2))) as ComplianceRow[];

  return (
    <main className="wrap">
      <nav aria-label="Breadcrumb" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 4 }}>
        <Link href="/audit/dashboard" className="lnk">Audit</Link>
        <span aria-hidden="true" style={{ margin: "0 7px", color: "#cdd2dc" }}>/</span>
        <span aria-current="page">Compliance</span>
      </nav>
      <PageHeader
        title="Compliance — DPDP & CERT-In"
        subtitle="Data-protection (DPDP Act), CERT-In directions & security-policy posture."
        actions={<GenerateReportButton items={items} />}
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="📜" iconBg="#f5f3ff" label="Compliance Score" value={`${score}%`} />
        <StatCard icon="🔏" iconBg="#e6f7f0" label="Controls Complied" value={`${complied} / ${total}`} />
        <StatCard icon="🛡️" iconBg="#eff8ff" label="CERT-In Directions" value={overdue === 0 ? "Compliant" : "Review"} delta="6-hr reporting" up={overdue === 0} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Open Actions" value={pending + overdue} />
      </div>
      {source === "error" && <DataSourceBadge source={source} />}
      <div className="grid g-2">
        <div className="card">
          <div className="card-h"><h3>Compliance requirements</h3></div>
          {displayDpdp.length === 0 ? (
            <EmptyState icon="📜" title="No items" message="Compliance requirements will appear here once configured." />
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
    </main>
  );
}
