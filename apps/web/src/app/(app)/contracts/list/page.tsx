import Link from "next/link";
import { PageHeader, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { getContracts, getVendorOptions } from "../../../_data/loaders";
import { toHumanError } from "@/lib/messages";
import { ContractsTable, type ContractRow } from "./ContractsTable";

export default async function ContractsListPage() {
  // GAP-CONTRACTS-LIST-01: resolve vendor names web-side (cross-service HTTP
  // read, never a cross-DB join). The vendor fetch is deliberately non-fatal:
  // if it fails the table shows "Unknown vendor" (never a raw UUID), while the
  // contracts fetch failure still drives the single error state below.
  const [{ data, source }, vendorsRes] = await Promise.all([getContracts(), getVendorOptions()]);

  const vendorNames: Record<string, string> =
    vendorsRes.source === "api"
      ? Object.fromEntries(vendorsRes.data.map((v) => [v.id, v.name]))
      : {};
  const vendorNamesUnavailable = vendorsRes.source === "error";

  const rows: ContractRow[] = data.map((row) => ({
    ...row,
    id: row.id,
    label: row.label,
    vendorId: row.sublabel ?? undefined,
    status: row.status ?? "—",
    meta: row.meta ?? "—",
    expiry: row.expiry,
    valueMinor: row.valueMinor,
  }));

  return (
    <div className="wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Contracts"
        subtitle="All registered contracts across departments."
        back="/contracts"
        actions={
          <Link
            href="/contracts/new"
            className="btn primary"
            style={{ minHeight: 44, minWidth: 44, display: "inline-flex", alignItems: "center" }}
          >
            + New Contract
          </Link>
        }
      />

      {/* GAP-CONTRACTS-LIST-02: a single error block. The old code stacked a
          DataSourceBadge ("Couldn't load — showing nothing") above
          RefreshErrorState for the same failure — two banners, only one with a
          Retry. RefreshErrorState already carries the retry + back actions. */}
      {source === "error" ? (
        <RefreshErrorState error={toHumanError("load", { area: "contracts" })} backHref="/contracts" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="📄"
          title="No contracts found"
          message="Create your first contract to get started."
        />
      ) : (
        <div className="card">
          <ContractsTable
            rows={rows}
            vendorNames={vendorNames}
            vendorNamesUnavailable={vendorNamesUnavailable}
          />
        </div>
      )}
    </div>
  );
}
