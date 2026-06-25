import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard } from "../../../_components/ds";
import { getRiskRegister } from "../../../_data/loaders";
import { RiskTable } from "./RiskTable";
import { AddRiskButton } from "./AddRiskButton";

export default async function RiskRegisterPage() {
  const { data: items, source } = await getRiskRegister();

  const total = items.length;
  const high = items.filter((i) => i.riskScore >= 15).length;
  const medium = items.filter((i) => i.riskScore >= 6 && i.riskScore < 15).length;
  const low = items.filter((i) => i.riskScore < 6).length;

  return (
    <main className="wrap">
      <nav aria-label="Breadcrumb" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 4 }}>
        <Link href="/audit/dashboard" className="lnk">Audit</Link>
        <span aria-hidden="true" style={{ margin: "0 7px", color: "#cdd2dc" }}>/</span>
        <span aria-current="page">Risk Register</span>
      </nav>
      <PageHeader
        title="Enterprise Risk Register"
        subtitle="Identify, score (likelihood × impact) and own risks."
        actions={<AddRiskButton />}
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="⚠️" iconBg="#fef2f2" label="Total Risks" value={total} />
        <StatCard icon="🔴" iconBg="#fff7ed" label="High" value={high} />
        <StatCard icon="🟡" iconBg="#fffaeb" label="Medium" value={medium} />
        <StatCard icon="🟢" iconBg="#ecfdf3" label="Low / Controlled" value={low} />
      </div>
      {source === "error" && <DataSourceBadge source={source} />}
      <RiskTable items={items} />
    </main>
  );
}
