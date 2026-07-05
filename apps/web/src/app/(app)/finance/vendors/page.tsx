import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinanceVendors } from "@/app/_data/loaders";
import { VendorsTable } from "./VendorsTable";

export default async function VendorsPage() {
  const { data: vendors, source } = await getFinanceVendors();
  const active = vendors.filter((v) => String((v as unknown as Record<string, unknown>).status ?? "").toLowerCase() === "active").length;
  const pending = vendors.filter((v) => String((v as unknown as Record<string, unknown>).status ?? "").toLowerCase() === "pending").length;

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
        <StatCard icon="📊" iconBg="#eff6ff" label="Categories" value={new Set(vendors.map((v) => String(v.category ?? ""))).size} />
      </StatGrid>
      <Card title="Vendors">
        <VendorsTable vendors={vendors as unknown as Record<string, unknown>[]} source={source === "error" ? "error" : "api"} />
      </Card>
    </main>
  );
}
