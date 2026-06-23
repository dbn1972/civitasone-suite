import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, StatusPill, EmptyState } from "../../../_components/ds";
import { getProcurementGRNs } from "../../../_data/loaders";
import { ListToolbar } from "../_components/ListToolbar";
import { paginateList, type ListSearchParams } from "../_components/listUtils";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  received: "Received",
  quality_check: "Quality Check",
  accepted: "Accepted",
  partially_rejected: "Partially Rejected",
  rejected: "Rejected",
};

export default async function GRNPage({ searchParams }: { searchParams: ListSearchParams }) {
  const pageSize = Math.min(50, Math.max(5, Number.parseInt(searchParams.limit ?? "10", 10) || 10));
  const offset = (Math.max(1, Number.parseInt(searchParams.page ?? "1", 10) || 1) - 1) * pageSize;
  const { data: grns, source } = await getProcurementGRNs({
    limit: pageSize,
    offset,
    q: searchParams.q,
  });
  const { rows, total, page, limit, pageCount, q } = paginateList(grns, { ...searchParams, limit: String(pageSize) });

  const accepted = grns.filter((g) => g.status === "accepted").length;
  const pendingQC = grns.filter((g) => g.status === "quality_check" || g.status === "received").length;
  const rejected = grns.filter((g) => g.status === "rejected" || g.status === "partially_rejected").length;

  return (
    <>
      <PageHeader
        title="Goods Receipt Notes"
        subtitle="Record and track goods received against purchase orders."
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
        <div className="pad" style={{ paddingBottom: 0 }}>
          <ListToolbar basePath="/procurement/grn" total={Math.max(total, grns.length)} page={page} limit={limit} pageCount={pageCount} q={q} />
        </div>
        {rows.length === 0 ? (
          <EmptyState icon="📦" title="No GRNs found" message="Create a new GRN when goods arrive." />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>GRN No</th>
                <th>PO Ref</th>
                <th>Vendor</th>
                <th>Received Date</th>
                <th className="num">Items</th>
                <th>Match</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((grn) => (
                <tr key={grn.id} className="clickable">
                  <td>
                    <Link href={`/procurement/grn/${grn.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                      <span className="mono">{grn.grnNo}</span>
                    </Link>
                  </td>
                  <td><span className="mono">{grn.poRef}</span></td>
                  <td>{grn.vendor}</td>
                  <td>{grn.receivedDate}</td>
                  <td className="num">{grn.itemCount}</td>
                  <td>
                    {grn.threeWayMatch === undefined ? "—" : (
                      <span style={{ color: grn.threeWayMatch ? "#16a34a" : "#b91c1c", fontWeight: 500 }}>
                        {grn.threeWayMatch ? "✓" : "✗"}
                      </span>
                    )}
                  </td>
                  <td><StatusPill status={grn.status} label={STATUS_LABELS[grn.status] ?? grn.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
