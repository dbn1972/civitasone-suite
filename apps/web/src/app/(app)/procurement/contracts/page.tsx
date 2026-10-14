import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { ProcurementContractsTable, type ContractRow } from "./ProcurementContractsTable";
import { PageHeader, StatGrid, StatCard, Card, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { getContracts, getProcurementVendors } from "../../../_data/loaders";
import { toHumanError } from "@/lib/messages";
import { getTranslations } from "next-intl/server";

export default async function ProcurementContractsPage({
  searchParams,
}: {
  searchParams?: { status?: string };
} = {}) {
  const t = await getTranslations("procurement.contractsPage");
  // GAP-PROCUREMENT-CONTRACTS-01: the contract list only carries a raw
  // vendorId, so resolve ids to names via the procurement vendor directory.
  // The vendors fetch is best-effort — if it fails, we fall back to a friendly
  // label and never blank the contracts list (the contracts fetch is the one
  // that gates the page).
  const [{ data: contracts, source }, vendorsResult] = await Promise.all([
    getContracts(),
    getProcurementVendors({ limit: 500 }),
  ]);

  const vendorNames = new Map<string, string>();
  if (vendorsResult.source !== "error") {
    for (const v of vendorsResult.data) vendorNames.set(v.id, v.name);
  }

  const errored = source === "error";
  const active = contracts.filter((c) => c.status === "active").length;
  const expiring = contracts.filter((c) => c.status === "expiring").length;
  const expired = contracts.filter((c) => c.status === "expired").length;

  // GAP-PROCUREMENT-CONTRACTS-03: the "Expiring Soon" card drills into
  // ?status=expiring; honour it so the card and the list agree.
  // "renewal_due" is the dashboard card's deep-link name for the same set.
  const rawStatus = (searchParams?.status ?? "").trim().toLowerCase();
  const statusFilter = rawStatus === "renewal_due" ? "expiring" : rawStatus;
  const visible = statusFilter ? contracts.filter((c) => (c.status ?? "").toLowerCase() === statusFilter) : contracts;

  const rows: ContractRow[] = visible.map((c) => {
    // sublabel from the mapper is the raw vendorId; never print it.
    const rawVendorId = c.sublabel ?? "";
    const vendorName = rawVendorId ? vendorNames.get(rawVendorId) ?? "Unknown vendor" : "—";
    return {
      id: c.id,
      label: c.label,
      sublabel: vendorName,
      meta: c.meta ?? "—",
      status: c.status ?? "",
      // GAP-PROCUREMENT-CONTRACTS-03/05: raw expiry (ISO), valueMinor (paise
      // string) and poRef travel to the client table, which formats them.
      expiry: c.expiry ?? "",
      valueMinor: c.valueMinor ?? "",
      poRef: c.poRef ?? "",
    };
  });

  return (
    <>
      <PageHeader
        title="Contracts Register"
        subtitle="Active and historical procurement contracts with renewal tracking."
        actions={
          <>
            {/* GAP-PROCUREMENT-CONTRACTS-02 / -NEW-04: the "Templates" link went
                to ?template=1, which the New Contract page ignores (no template
                source exists anywhere). Removed rather than linking to a
                dead-end — re-add only once a real template source lands. */}
            <Link href="/procurement/contracts/new" className="btn primary">+ New Contract</Link>
            {source === "error" ? <DataSourceBadge source={source} message="Couldn't load — showing nothing" /> : null}
          </>
        }
      />

      <StatGrid>
        {/* GAP-PROCUREMENT-CONTRACTS-04: show '—' on a failed load, never a
            fabricated 0 under the error state below. */}
        <StatCard icon="📄" iconBg="#e7edfd" label="Total Contracts" value={errored ? "—" : contracts.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={errored ? "—" : active} />
        <StatCard icon="⏰" iconBg="#fffaeb" label="Expiring Soon" value={errored ? "—" : expiring} href={errored ? undefined : "/procurement/contracts?status=expiring"} />
        <StatCard icon="🔒" iconBg="#f1f5f9" label="Expired" value={errored ? "—" : expired} />
      </StatGrid>

      <Card title="Contracts list">
        {statusFilter ? (
          <p role="status" style={{ margin: "0 0 12px", fontSize: "0.875rem" }}>
            {t("filteredBy", { status: statusFilter })}{" "}
            <Link href="/procurement/contracts">{t("clearFilter")}</Link>
          </p>
        ) : null}
        {errored ? (
          // GAP-PROCUREMENT-CONTRACTS-04: RefreshErrorState gives a working
          // Retry (router.refresh re-runs the server fetch) from a server page.
          <RefreshErrorState error={toHumanError("load", { area: "contracts" })} backHref="/procurement/contracts" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="📄"
            title="No contracts found"
            message="Create a new contract to get started."
            action={<Link href="/procurement/contracts/new" className="btn primary">+ New Contract</Link>}
          />
        ) : (
          // GAP-PROCUREMENT-CONTRACTS-03/05: the table is a client component so
          // its date / money / PO-link cells can use render functions.
          <ProcurementContractsTable rows={rows} />
        )}
      </Card>
    </>
  );
}
