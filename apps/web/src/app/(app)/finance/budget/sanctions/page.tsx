import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "../../../../_components/ds";
import { getFinanceSanctions } from "../../../../_data/loaders";
import { SanctionsTable } from "./SanctionsTable";

export default async function SanctionsPage() {
  const { data: sanctions, source } = await getFinanceSanctions();

  const approved = sanctions.filter((s) => s.status === "approved").length;
  const pending = sanctions.filter((s) => s.status === "pending").length;
  const totalAmount = sanctions.reduce((sum, s) => sum + s.amount, 0);

  return (
    <>
      <PageHeader
        title="Sanction Management"
        subtitle="Administrative &amp; financial sanctions with budget check."
        actions={
          <>
            <button className="btn ghost">Templates</button>
            <button className="btn primary">+ New Sanction</button>
            {source === "error" ? <DataSourceBadge source={source} /> : null}
          </>
        }
      />

      <StatGrid>
        <StatCard icon="🖊️" iconBg="#e7edfd" label="Active Sanctions" value={sanctions.length} />
        <StatCard icon="💰" iconBg="#eff6ff" label="Sanctioned (FY)" value={`₹${(totalAmount / 100).toLocaleString("en-IN")}`} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending Approval" value={pending} />
        <StatCard icon="📊" iconBg="#ecfdf3" label="Approved" value={approved} delta="✓" up={true} />
      </StatGrid>

      <Card title="Administrative & financial sanctions">
        <SanctionsTable sanctions={sanctions} source={source} />
      </Card>
    </>
  );
}
