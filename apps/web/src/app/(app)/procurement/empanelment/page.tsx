import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "../../../_components/ds";
import { getProcurementEmpanelment } from "../../../_data/loaders";
import { EmpanelmentTable } from "./EmpanelmentTable";

export default async function EmpanelmentPage() {
  const { data: vendors, source } = await getProcurementEmpanelment();

  const active = vendors.filter((v) => v.status === "Active").length;
  const expiring = vendors.filter((v) => v.status === "Expiring").length;
  const totalRating = vendors.reduce((sum, v) => sum + v.rating, 0);
  const avgRating = vendors.length > 0 ? (totalRating / vendors.length).toFixed(1) : "—";

  return (
    <>
      <PageHeader
        title="Vendor Empanelment"
        subtitle="Empanelled vendors with category-wise validity and performance ratings."
        actions={source === "error" ? <DataSourceBadge source={source} message="Couldn't load — showing nothing" /> : null}
      />

      <StatGrid>
        <StatCard icon="🏢" iconBg="#eef2ff" label="Total Empanelled" value={vendors.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={active} />
        <StatCard icon="⏰" iconBg="#fffaeb" label="Expiring Soon" value={expiring} />
        <StatCard icon="⭐" iconBg="#fce7ee" label="Avg. Rating" value={avgRating} />
      </StatGrid>

      <EmpanelmentTable vendors={vendors} source={source} />
    </>
  );
}
