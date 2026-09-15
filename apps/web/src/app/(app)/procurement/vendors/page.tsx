import Link from "next/link";
import { PageHeader, StatGrid, StatCard } from "../../../_components/ds";
import { getProcurementVendors } from "../../../_data/loaders";
import { VendorsTable } from "./VendorsTable";

export default async function VendorsPage() {
  const { data: vendors, source } = await getProcurementVendors({ limit: 500 });

  const empanelled = vendors.filter((v) => v.empanelmentStatus === "empanelled").length;
  const provisional = vendors.filter((v) => v.empanelmentStatus === "provisional").length;
  const blacklisted = vendors.filter((v) => v.empanelmentStatus === "blacklisted").length;

  return (
    <>
      {/* UX-012: the data-source badge now lives inside VendorsTable, driven
          by the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree with
          the table's own cache state (UX-002's pattern). */}
      <PageHeader
        title="Vendor Directory"
        subtitle="Approved vendor directory with empanelment status and performance ratings."
        actions={
          <Link href="/procurement/vendors/new" className="btn primary">+ Register Vendor</Link>
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
