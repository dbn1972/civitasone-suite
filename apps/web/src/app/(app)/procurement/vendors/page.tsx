import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard } from "../../../_components/ds";
import { getProcurementVendors } from "../../../_data/loaders";
import type { ListSearchParams } from "../_components/listUtils";
import { VendorsTable } from "./VendorsTable";

export default async function VendorsPage({ searchParams }: { searchParams: ListSearchParams }) {
  const { data: vendors, source } = await getProcurementVendors({ limit: 500, q: searchParams.q });

  const empanelled = vendors.filter((v) => v.empanelmentStatus === "empanelled").length;
  const provisional = vendors.filter((v) => v.empanelmentStatus === "provisional").length;
  const blacklisted = vendors.filter((v) => v.empanelmentStatus === "blacklisted").length;

  return (
    <>
      <PageHeader
        title="Vendor Directory"
        subtitle="Approved vendor directory with empanelment status and performance ratings."
        actions={
          <>
            <Link href="/procurement/vendors/new" className="btn primary">+ Register Vendor</Link>
            {source === "error" ? <DataSourceBadge source={source} /> : null}
          </>
        }
      />

      <StatGrid>
        <StatCard icon="🏢" iconBg="#e7edfd" label="Total Vendors" value={vendors.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Empanelled" value={empanelled} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Provisional" value={provisional} />
        <StatCard icon="🚫" iconBg="#fef3f2" label="Blacklisted" value={blacklisted} />
      </StatGrid>

      <VendorsTable vendors={vendors} source={source} />
    </>
  );
}
