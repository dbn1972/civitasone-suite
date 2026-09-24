import Link from "next/link";
import { PageHeader, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getContracts } from "../../../_data/loaders";
import { toHumanError } from "@/lib/messages";
import { ContractsTable } from "./ContractsTable";

type ContractRow = {
  id: string;
  label: string;
  sublabel: string;
  status: string;
  meta: string;
} & Record<string, unknown>;

export default async function ContractsListPage() {
  const { data, source } = await getContracts();

  const rows: ContractRow[] = data.map((row) => ({
    ...row,
    id: row.id,
    label: row.label,
    sublabel: row.sublabel ?? "—",
    status: row.status ?? "—",
    meta: row.meta ?? "—",
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

      {source === "error" && <DataSourceBadge source={source} />}

      {source === "error" ? (
        <RefreshErrorState error={toHumanError("load", { area: "contracts" })} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="📄"
          title="No contracts found"
          message="Create your first contract to get started."
        />
      ) : (
        <div className="card">
          <ContractsTable rows={rows} />
        </div>
      )}
    </div>
  );
}
