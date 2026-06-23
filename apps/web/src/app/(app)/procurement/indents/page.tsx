import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, StatusPill, EmptyState } from "../../../_components/ds";
import { getProcurementIndents } from "../../../_data/loaders";
import { ListToolbar } from "../_components/ListToolbar";
import { paginateList, type ListSearchParams } from "../_components/listUtils";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Pending Approval",
  approved: "Approved",
  rejected: "Rejected",
  converted_to_po: "Converted to PO",
};

export default async function IndentsPage({ searchParams }: { searchParams: ListSearchParams }) {
  const pageSize = Math.min(50, Math.max(5, Number.parseInt(searchParams.limit ?? "10", 10) || 10));
  const { data: indents, source } = await getProcurementIndents({
    limit: 500,
    q: searchParams.q,
  });
  const { rows, total, page, limit, pageCount, q } = paginateList(indents, { ...searchParams, limit: String(pageSize) });

  const pendingApproval = indents.filter((i) => i.status === "pending_approval").length;
  const approved = indents.filter((i) => i.status === "approved").length;
  const converted = indents.filter((i) => i.status === "converted_to_po").length;

  return (
    <>
      <PageHeader
        title="Purchase Indents"
        subtitle="Track material requisitions from departments through to PO conversion."
        actions={
          <>
            <Link href="/procurement/indents/new" className="btn primary">+ New Indent</Link>
            {source === "error" ? <DataSourceBadge source={source} /> : null}
          </>
        }
      />

      <StatGrid>
        <StatCard icon="📋" iconBg="#e7edfd" label="Total Indents" value={indents.length} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending Approval" value={pendingApproval} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Approved" value={approved} />
        <StatCard icon="📦" iconBg="#eff6ff" label="Converted to PO" value={converted} />
      </StatGrid>

      <Card title="All indents">
        <div className="pad" style={{ paddingBottom: 0 }}>
          <ListToolbar basePath="/procurement/indents" total={total} page={page} limit={limit} pageCount={pageCount} q={q} />
        </div>
        {rows.length === 0 ? (
          <EmptyState icon="📋" title="No indents found" message="Create a new indent to get started." />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Indent No</th>
                <th>Requested By</th>
                <th>Department</th>
                <th className="num">Items</th>
                <th className="num">Est. Amount</th>
                <th>Request Date</th>
                <th>Required By</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((indent) => (
                <tr key={indent.id} className="clickable">
                  <td>
                    <Link href={`/procurement/indents/${indent.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                      <span className="mono">{indent.indentNo}</span>
                    </Link>
                  </td>
                  <td>{indent.requestedBy}</td>
                  <td>{indent.department}</td>
                  <td className="num">{indent.itemCount}</td>
                  <td className="num">₹{(indent.estimatedAmount / 100).toLocaleString("en-IN")}</td>
                  <td>{indent.requestDate}</td>
                  <td>{indent.requiredByDate ?? "—"}</td>
                  <td><StatusPill status={indent.status} label={STATUS_LABELS[indent.status] ?? indent.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
