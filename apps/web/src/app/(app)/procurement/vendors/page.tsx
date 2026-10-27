import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "../../../_components/ds";
import { maskPhone } from "../../../_components/ds/Masked";
import { getProcurementVendors, getProcurementVendorSummary } from "../../../_data/loaders";
import { VendorsTable } from "./VendorsTable";

// D4c #21 (GAP-PROCUREMENT-VENDORS-03): the directory is fetched one server page
// at a time (limit/offset from ?page=), so no vendor is hidden behind a fetch cap.
const VENDOR_PAGE_SIZE = 50;

function readParam(searchParams: Record<string, string | string[] | undefined> | undefined, key: string): string | undefined {
  const v = searchParams?.[key];
  return Array.isArray(v) ? v[0] : v;
}

export default async function VendorsPage(props: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const searchParams = await props.searchParams;
  const tw = await getTranslations("procurement.w2.vendors");
  const pageParam = Number(readParam(searchParams, "page") ?? "1");
  const pageNo = Number.isFinite(pageParam) && pageParam >= 1 ? Math.floor(pageParam) : 1;
  const offset = (pageNo - 1) * VENDOR_PAGE_SIZE;
  const VENDOR_LIST_LIMIT = VENDOR_PAGE_SIZE;
  const [{ data: vendors, source }, { data: summary }] = await Promise.all([
    getProcurementVendors({ limit: VENDOR_LIST_LIMIT, offset }),
    // GAP-PROCUREMENT-VENDORS-03: whole-directory counts for the stat tiles. A
    // failed summary is simply null - the table then falls back to its own rows.
    getProcurementVendorSummary(),
  ]);
  // GAP-...-VENDORS-03 (interim): the list is capped at the fetch limit and the
  // DataTable pages client-side, so a tenant with more vendors than the limit
  // is silently truncated. Until the backend returns a true total + server
  // pagination (HUMAN REVIEW), surface an honest "showing first N" notice when
  // we hit the cap so the count is never mistaken for the whole directory.
  const hasNext = summary ? offset + VENDOR_PAGE_SIZE < summary.total : vendors.length >= VENDOR_LIST_LIMIT;
  const truncated = hasNext || pageNo > 1;
  const pageHref = (n: number) => (n > 1 ? `/procurement/vendors?page=${n}` : "/procurement/vendors");
  const pager = (hasNext || pageNo > 1) ? (
    <nav className="dt-pager" aria-label={tw("pagerLabel")} style={{ display: "flex", gap: 8, alignItems: "center", marginBlockStart: 10 }}>
      {pageNo > 1 ? <Link className="btn ghost" href={pageHref(pageNo - 1)}>{tw("prev")}</Link> : null}
      <span aria-live="polite" style={{ fontSize: 13, color: "var(--mut)" }}>{tw("page", { page: pageNo })}</span>
      {hasNext ? <Link className="btn ghost" href={pageHref(pageNo + 1)}>{tw("next")}</Link> : null}
    </nav>
  ) : null;
  // GAP-PROCUREMENT-VENDORS-02 (DPDP): the raw phone never leaves the server. The table
  // (and its offline cache) only ever holds the masked form; the clear value is
  // available from the vendor profile through the audited reveal.
  const maskedVendors = vendors.map((v) => (v.phone ? { ...v, phone: maskPhone(v.phone) } : v));

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

      <VendorsTable vendors={maskedVendors} source={source} truncated={truncated} limit={VENDOR_LIST_LIMIT} summary={summary} />
      {pager}
    </>
  );
}
