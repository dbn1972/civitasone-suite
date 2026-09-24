import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { formatMoney } from "@/lib/formatters";
import { getGrants } from "../../../_data/loaders";
import { GrantsTable } from "./GrantsTable";
import { ArrowLeft } from "lucide-react";

export default async function GrantsListPage() {
  const { data: grants, source } = await getGrants();
  const active = grants.filter((g) => g.status === "active").length;
  const totalSanctioned = grants.reduce((s, g) => s + g.totalAmount, 0);
  const totalDisbursed = grants.reduce((s, g) => s + g.disbursedAmount, 0);

  return (
    <>
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/grants">Grants</a>
      </nav>
      <PageHeader title="Grants" subtitle="All grants with lifecycle status." />
      {/* UX-012: the data-source badge now lives inside GrantsTable, driven
          by the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree with
          the table's own cache state (UX-002's pattern). */}
      <div aria-label="Grants list">
        <StatGrid>
          <StatCard icon="🎁" iconBg="#dcfce7" label="Total" value={grants.length} />
          <StatCard icon="✅" iconBg="#f0fdf4" label="Active" value={active} />
          <StatCard icon="💰" iconBg="#f1f5f9" label="Sanctioned" value={formatMoney(totalSanctioned)} />
          <StatCard icon="📤" iconBg="#dbeafe" label="Disbursed" value={formatMoney(totalDisbursed)} />
        </StatGrid>
        <Card title="Grants List">
          <GrantsTable grants={grants} source={source} />
        </Card>
      </div>
    </>
  );
}
