import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinanceVendors } from "@/app/_data/loaders";
import Link from "next/link";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { VendorsTable } from "./VendorsTable";
import { maskPan } from "@/app/_components/ds/Masked";
import { canWrite, VENDOR_WRITE_ROLES } from "@/lib/finance/writeRoles";
import { vendorStats } from "./vendorStats";

export default async function VendorsPage() {
  const { data: vendors, source } = await getFinanceVendors();
  const stats = vendorStats(vendors);
  // finance-service creates vendors already active and has no pending/approval
  // state (status is derived from isActive only), so a "Pending Approval"
  // count would be a permanent, fabricated 0. The card shows "—" and says so
  // until a real approval workflow exists (GAP-FINANCE-VENDORS-01).
  // Creating a vendor is restricted to finance_admin / super_admin server-side;
  // an empty role list (no role claim) does not hide it -- the server decides.
  const roles = getSessionRoles();
  const canCreate = canWrite(roles, VENDOR_WRITE_ROLES);

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      {/* UX-002: the data-source badge now lives in VendorsTable, driven by
          the same useSeededResource call that produces its rows. */}
      <PageHeader
        title="Vendor Master"
        subtitle="Registered vendors with PAN, GSTIN, and category classification."
        back="/finance"
        actions={canCreate ? <Link href="/finance/vendors/new" className="btn primary">New vendor</Link> : null}
      />
      <StatGrid>
        <StatCard icon="🏢" iconBg="#e7edfd" label="Total Vendors" value={stats.total} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={stats.active} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending Approval (not tracked yet)" value={null} />
        <StatCard icon="📊" iconBg="#eff6ff" label="Categories" value={stats.categories} />
      </StatGrid>
      <Card title="Vendors">
        {/* PAN is masked HERE, on the server, so the full PAN never reaches the client table
            (or its offline cache / CSV export). */}
        <VendorsTable vendors={vendors.map((v) => ({ ...v, pan: v.pan ? maskPan(String(v.pan)) : v.pan }))} source={source === "error" ? "error" : "api"} />
      </Card>
    </div>
  );
}
