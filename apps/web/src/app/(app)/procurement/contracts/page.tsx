import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, DataTable, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { getContracts, getProcurementVendors } from "../../../_data/loaders";
import { toHumanError } from "@/lib/messages";

type ContractRow = {
  id: string;
  label: string;
  sublabel: string;
  meta: string;
  status: string;
} & Record<string, unknown>;

export default async function ProcurementContractsPage() {
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

  const rows: ContractRow[] = contracts.map((c) => {
    // sublabel from the mapper is the raw vendorId; never print it.
    const rawVendorId = c.sublabel ?? "";
    const vendorName = rawVendorId ? vendorNames.get(rawVendorId) ?? "Unknown vendor" : "—";
    return {
      id: c.id,
      label: c.label,
      sublabel: vendorName,
      meta: c.meta ?? "—",
      status: c.status ?? "",
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
        <StatCard icon="⏰" iconBg="#fffaeb" label="Expiring Soon" value={errored ? "—" : expiring} />
        <StatCard icon="🔒" iconBg="#f1f5f9" label="Expired" value={errored ? "—" : expired} />
      </StatGrid>

      <Card title="Contracts list">
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
          <DataTable<ContractRow>
            rows={rows}
            sortable
            filterable
            filterPlaceholder="Filter by contract, vendor, status…"
            pageSize={10}
            // GAP-PROCUREMENT-CONTRACTS-03: link the contract title to the
            // existing detail route /contracts/[id] so a row is openable.
            rowLinkKey="id"
            rowLinkPrefix="/contracts/"
            columns={[
              { key: "label", label: "Contract" },
              { key: "sublabel", label: "Vendor / Counter-party" },
              // Was labeled "Type": getContracts() has never had a contract
              // "type" field to offer (contract-service has no such column) --
              // meta is, and always was, the contract number.
              { key: "meta", label: "Contract No." },
              { key: "status", label: "Status", cellType: "status" },
            ]}
          />
        )}
      </Card>
    </>
  );
}
