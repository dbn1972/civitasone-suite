import Link from "next/link";
import { PageHeader } from "../../../_components/ds";
import { getProcurementEmpanelment } from "../../../_data/loaders";
import { EmpanelmentTable } from "./EmpanelmentTable";

export default async function EmpanelmentPage() {
  const { data: vendors, source } = await getProcurementEmpanelment();

  return (
    <>
      {/* GAP-PROCUREMENT-EMPANELMENT-01/03/04: stats, the error/empty state and
          the table all live in the client component, derived from the SAME
          useSeededResource read, so a failed fetch can never read as an empty
          empanelment list (which gates RFQ invitations) and stats can never
          disagree with the rows shown. */}
      <PageHeader
        title="Vendor Empanelment"
        // GAP-PROCUREMENT-EMPANELMENT-04: honest subtitle — read-only register
        // today (no empanel/renew/suspend/blacklist workflow on this surface).
        subtitle="Read-only register of empanelled vendors with category-wise validity and performance ratings."
        actions={
          <Link href="/procurement/vendors" className="btn ghost">
            Vendor register
          </Link>
        }
      />

      <EmpanelmentTable vendors={vendors} source={source} />
    </>
  );
}
