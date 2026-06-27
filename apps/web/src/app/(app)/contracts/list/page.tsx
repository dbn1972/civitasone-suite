import Link from "next/link";
import { PageHeader, DataTable, EmptyState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getContracts } from "../../../_data/loaders";

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
    <main className="wrap" aria-labelledby="page-heading">
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

      {rows.length === 0 ? (
        <EmptyState
          icon="📄"
          title="No contracts found"
          message="Create your first contract to get started."
        />
      ) : (
        <div className="card">
          <DataTable<ContractRow>
            columns={[
              {
                key: "label",
                label: "Title",
                render: (r) => (
                  <Link href={`/contracts/${r.id}`} className="lnk">
                    {r.label}
                  </Link>
                ),
              },
              { key: "sublabel", label: "Party / Info" },
              { key: "meta", label: "Type" },
              {
                key: "status",
                label: "Status",
                render: (r) => {
                  const s = r.status.toLowerCase();
                  const cls = s === "active" ? "good" : s === "expired" ? "bad" : "mut";
                  return <span className={`pill ${cls}`}>{r.status}</span>;
                },
              },
            ]}
            rows={rows}
          />
        </div>
      )}
    </main>
  );
}
