import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard } from "../../../_components/ds";
import { getAuditPlan } from "../../../_data/loaders";
import { PlanTable } from "./PlanTable";
import { PlanAuditButton } from "./PlanAuditButton";

export default async function AuditPlanPage() {
  const { data: items, source } = await getAuditPlan();

  const total = items.length;
  const completed = items.filter((i) => i.status === "completed").length;
  const inProgress = items.filter((i) => i.status === "in_progress").length;
  const riskBased = total > 0 ? Math.round(((total - items.filter((i) => i.type === "routine").length) / total) * 100) : 0;

  return (
    <main className="wrap">
      <nav aria-label="Breadcrumb" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 4 }}>
        <Link href="/audit/dashboard" className="lnk">Audit</Link>
        <span aria-hidden="true" style={{ margin: "0 7px", color: "#cdd2dc" }}>/</span>
        <span aria-current="page">Audit Plan</span>
      </nav>
      <PageHeader
        title="Internal Audit Planning"
        subtitle="Risk-based annual audit plan & universe."
        actions={<PlanAuditButton />}
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="🗓️" iconBg="#fef2f2" label="Planned Audits" value={total} delta="FY26" />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Completed" value={completed} />
        <StatCard icon="🔄" iconBg="#fffaeb" label="In Progress" value={inProgress} />
        <StatCard icon="🎯" iconBg="#eff6ff" label="Risk-based" value={`${riskBased}%`} delta="coverage" up />
      </div>
      {source === "error" && <DataSourceBadge source={source} />}
      <PlanTable items={items} />
    </main>
  );
}
