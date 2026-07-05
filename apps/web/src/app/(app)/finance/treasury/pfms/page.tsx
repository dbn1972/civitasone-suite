import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinancePFMSScrolls } from "@/app/_data/loaders";
import { PFMSTable } from "./PFMSTable";

export default async function PfmsPage() {
  const { data: scrolls, source } = await getFinancePFMSScrolls();
  const approved = scrolls.filter((s) => String(s.status).toLowerCase() === "approved").length;
  const pending = scrolls.filter((s) => String(s.status).toLowerCase() === "pending").length;
  const rejected = scrolls.filter((s) => String(s.status).toLowerCase() === "rejected").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="PFMS Integration"
        subtitle="Public Financial Management System — payment scroll tracking and beneficiary verification."
        back="/finance"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />
      <StatGrid>
        <StatCard icon="📜" iconBg="#e7edfd" label="Total Scrolls" value={scrolls.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Approved" value={approved} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending" value={pending} />
        <StatCard icon="❌" iconBg="#fce7ee" label="Rejected" value={rejected} />
      </StatGrid>
      <Card title="Payment Scrolls">
        <PFMSTable scrolls={scrolls} source={source === "error" ? "error" : "api"} />
      </Card>
    </main>
  );
}
