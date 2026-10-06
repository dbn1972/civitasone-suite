import Link from "next/link";
import { PageHeader } from "../../../_components/ds";
import { getProcurementVendors } from "../../../_data/loaders";
import { VendorsTable } from "./VendorsTable";

export default async function VendorsPage() {
  const VENDOR_LIST_LIMIT = 500;
  const { data: vendors, source } = await getProcurementVendors({ limit: VENDOR_LIST_LIMIT });
  // GAP-...-VENDORS-03 (interim): the list is capped at the fetch limit and the
  // DataTable pages client-side, so a tenant with more vendors than the limit
  // is silently truncated. Until the backend returns a true total + server
  // pagination (HUMAN REVIEW), surface an honest "showing first N" notice when
  // we hit the cap so the count is never mistaken for the whole directory.
  const truncated = vendors.length >= VENDOR_LIST_LIMIT;

  return (
    <>
      {/* GAP-...-VENDORS-01: honest subtitle — the directory lists every
          empanelment status (incl. Blacklisted / Not Empanelled), not only
          approved vendors; a status filter in VendorsTable lets the user
          narrow it.
          GAP-...-VENDORS-04: the stat tiles now live INSIDE VendorsTable,
          driven by the same useSeededResource rows as the table, so tiles and
          table can never disagree and both show "—"/an error state on a failed
          load instead of a fabricated 0 and "No vendors found". */}
      <PageHeader
        title="Vendor Directory"
        subtitle="Vendor directory with empanelment status and performance ratings. Use the status filter to narrow the list."
        actions={
          <Link href="/procurement/vendors/new" className="btn primary">+ Register Vendor</Link>
        }
      />

      <VendorsTable vendors={vendors} source={source} truncated={truncated} limit={VENDOR_LIST_LIMIT} />
    </>
  );
}
