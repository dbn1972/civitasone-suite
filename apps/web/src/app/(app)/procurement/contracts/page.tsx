import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, DataTable, EmptyState } from "../../../_components/ds";
import { getContracts } from "../../../_data/loaders";

type ContractRow = {
  id: string;
  label: string;
  sublabel: string;
  meta: string;
  status: string;
} & Record<string, unknown>;

export default async function ProcurementContractsPage() {
  const { data: contracts, source } = await getContracts();

  const active = contracts.filter((c) => c.status === "active").length;
  const expiring = contracts.filter((c) => c.status === "expiring").length;
  const expired = contracts.filter((c) => c.status === "expired").length;

  const rows: ContractRow[] = contracts.map((c) => ({
    id: c.id,
    label: c.label,
    sublabel: c.sublabel ?? "—",
    meta: c.meta ?? "—",
    status: c.status ?? "",
  }));

  return (
    <>
      <PageHeader
        title="Contracts Register"
        subtitle="Active and historical procurement contracts with renewal tracking."
        actions={
          <>
            <Link href="/procurement/contracts/new?template=1" className="btn ghost">Templates</Link>
            <Link href="/procurement/contracts/new" className="btn primary">+ New Contract</Link>
            {source === "error" ? <DataSourceBadge source={source} message="Couldn't load — showing nothing" /> : null}
          </>
        }
      />

      <StatGrid>
        <StatCard icon="📄" iconBg="#e7edfd" label="Total Contracts" value={contracts.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={active} />
        <StatCard icon="⏰" iconBg="#fffaeb" label="Expiring Soon" value={expiring} />
        <StatCard icon="🔒" iconBg="#f1f5f9" label="Expired" value={expired} />
      </StatGrid>

      <Card title="Contracts list">
        {source === "error" ? (
          <EmptyState
            icon="⚠️"
            title="Couldn’t load contracts"
            message="The contract service didn’t respond. Check your connection and try again."
            action={<Link href="/procurement/contracts" className="btn ghost">Retry</Link>}
          />
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
            columns={[
              { key: "label", label: "Contract" },
              { key: "sublabel", label: "Vendor / Counter-party" },
              { key: "meta", label: "Type" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
          />
        )}
      </Card>
    </>
  );
}
