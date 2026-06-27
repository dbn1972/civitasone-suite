import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, DataTable, EmptyState } from "../../../_components/ds";
import { getProcurementGRNs } from "../../../_data/loaders";
import { formatIndianDate } from "@/lib/formatters";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  received: "Received",
  quality_check: "Quality Check",
  accepted: "Accepted",
  partially_rejected: "Partially Rejected",
  rejected: "Rejected",
};

type GRNRow = {
  id: string;
  grnNo: string;
  poRef: string;
  vendor: string;
  receivedDate: string;
  itemCount: number;
  match: string;
  status: string;
} & Record<string, unknown>;

export default async function GRNPage() {
  const { data: grns, source } = await getProcurementGRNs({ limit: 500 });

  const accepted = grns.filter((g) => g.status === "accepted").length;
  const pendingQC = grns.filter((g) => g.status === "quality_check" || g.status === "received").length;
  const rejected = grns.filter((g) => g.status === "rejected" || g.status === "partially_rejected").length;

  const rows: GRNRow[] = grns.map((g) => ({
    id: g.id,
    grnNo: g.grnNo,
    poRef: g.poRef,
    vendor: g.vendor,
    receivedDate: formatIndianDate(g.receivedDate),
    itemCount: g.itemCount,
    match: g.threeWayMatch === undefined ? "—" : g.threeWayMatch ? "Matched" : "Mismatch",
    status: STATUS_LABELS[g.status] ?? g.status,
  }));

  return (
    <>
      <PageHeader
        title="Goods Receipt Notes"
        subtitle="Record and track goods received against purchase orders."
        help="procurement"
        actions={
          <>
            <Link href="/procurement/grn/new" className="btn primary">+ New GRN</Link>
            {source === "error" ? <DataSourceBadge source={source} /> : null}
          </>
        }
      />

      <StatGrid>
        <StatCard icon="📦" iconBg="#e7edfd" label="Total GRNs" value={grns.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Accepted" value={accepted} />
        <StatCard icon="🔍" iconBg="#fffaeb" label="Pending QC" value={pendingQC} />
        <StatCard icon="❌" iconBg="#fef3f2" label="Rejected" value={rejected} />
      </StatGrid>

      <Card title="Goods receipt notes">
        {source === "error" ? (
          <EmptyState
            icon="⚠️"
            title="Couldn’t load GRNs"
            message="The procurement service didn’t respond. Check your connection and try again."
            action={<Link href="/procurement/grn" className="btn ghost">Retry</Link>}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="📦"
            title="No goods received yet"
            message="A Goods Received Note (GRN) is the check you do when a delivery arrives against an order. Create one when goods come in."
            action={<Link href="/procurement/grn/new" className="btn primary">+ New GRN</Link>}
          />
        ) : (
          <DataTable<GRNRow>
            rows={rows}
            rowLinkKey="id"
            rowLinkPrefix="/procurement/grn/"
            sortable
            filterable
            filterPlaceholder="Filter by GRN no, PO ref, vendor…"
            pageSize={10}
            columns={[
              { key: "grnNo", label: "GRN No" },
              { key: "poRef", label: "PO Ref" },
              { key: "vendor", label: "Vendor" },
              { key: "receivedDate", label: "Received Date" },
              { key: "itemCount", label: "Items", align: "right" },
              { key: "match", label: "Match" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
          />
        )}
      </Card>
    </>
  );
}
