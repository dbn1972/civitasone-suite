import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinanceVendors } from "@/app/_data/loaders";
import { VendorsTable } from "./VendorsTable";

export default async function VendorsPage() {
  const { data: vendors, source } = await getFinanceVendors();
  const active = vendors.filter((v) => v.status.toLowerCase() === "active").length;
  // No approval workflow exists yet (status is derived from isActive only —
  // see FinanceVendorSummary), so this will always read 0 until one is built.
  const pending = vendors.filter((v) => v.status.toLowerCase() === "pending").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Vendor Master"
        subtitle="Registered vendors with PAN, GSTIN, and category classification."
        back="/finance"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />
      <StatGrid>
        <StatCard icon="🏢" iconBg="#e7edfd" label="Total Vendors" value={vendors.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={active} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending Approval" value={pending} />
        <StatCard icon="📊" iconBg="#eff6ff" label="Categories" value={new Set(vendors.map((v) => v.category)).size} />
      </StatGrid>
      <Card title="Vendors">
        <VendorsTable vendors={vendors} source={source === "error" ? "error" : "api"} />
      </Card>
    </main>
  );
}
