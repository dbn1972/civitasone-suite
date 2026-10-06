import Link from "next/link";
import { PageHeader, StatCard, RefreshErrorState } from "../../../_components/ds";
import { getAuditDashboard } from "../../../_data/loaders";
import { toResourceState } from "../../../_data/useResource";
import { toHumanError } from "@/lib/messages";
import { AuditBreadcrumb } from "../_components/AuditBreadcrumb";
import { AUDIT_SECTIONS } from "../_components/auditNav";

export default async function AuditDashboardPage() {
  const result = await getAuditDashboard();
  const { data } = result;
  const resource = toResourceState(result);
  const errored = resource.status === "error";

  // GAP-AUDIT-DASHBOARD-01: on a fetch failure an outage must not read as a
  // zero-compliance department. Show "—" in every tile and a RefreshErrorState,
  // but keep Quick links so navigation still works during an outage.
  const openObs = errored ? null : data.openObservations;
  const riskItems = errored ? null : data.riskRegisterItems;
  const cagParas = errored ? null : data.cagParas;
  // GAP-AUDIT-DASHBOARD-05: AuditDashboardSchema already enforces
  // compliancePct: z.number().default(0) and fetchJson uses the PARSED value,
  // so toFixed cannot throw on current code (claim REFUTED). Keep a cheap
  // Number.isFinite guard anyway so any future schema loosening degrades to
  // "—" rather than crashing the dashboard.
  const compliancePct = errored || !Number.isFinite(data.compliancePct) ? null : `${data.compliancePct.toFixed(1)}%`;

  return (
    <div className="wrap">
      {/* GAP-AUDIT-DASHBOARD-04 / -03: give the overview an "Audit" parent that
          points at the module home (same as the sidebar). */}
      <AuditBreadcrumb current="Audit Dashboard" isHome />
      <PageHeader
        title="Audit & Compliance Dashboard"
        subtitle="Overview of audit observations, risk register, and compliance status."
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        {/* GAP-AUDIT-DASHBOARD-04: counts drill down to their list. */}
        <StatCard icon="📋" iconBg="var(--badbg)" label="Open Observations" value={openObs} href={errored ? undefined : "/audit/observations?status=open"} />
        <StatCard icon="⚠️" iconBg="var(--warnbg)" label="Risk Register Items" value={riskItems} href={errored ? undefined : "/audit/risk-register"} />
        <StatCard icon="📑" iconBg="var(--infobg)" label="CAG Paras" value={cagParas} href={errored ? undefined : "/audit/cag"} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label="Compliance" value={compliancePct} href={errored ? undefined : "/audit/compliance"} />
      </div>
      {errored && (
        <div style={{ marginBottom: 18 }}>
          <RefreshErrorState error={toHumanError("load", { area: "audit dashboard" })} />
        </div>
      )}
      <div className="card">
        <div className="card-h"><h3>Quick links</h3></div>
        <div className="pad">
          {/* GAP-AUDIT-DASHBOARD-02: a full index of the module — CAG Audit,
              Vigilance and Investigation were previously only reachable from the
              Event Log sub-nav. Sourced from the shared AUDIT_SECTIONS list. */}
          <nav aria-label="Audit sections" className="grid g-4">
            {AUDIT_SECTIONS.map((link) => (
              <Link key={link.href} href={link.href} className="card" style={{ padding: 16, fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </div>
  );
}
