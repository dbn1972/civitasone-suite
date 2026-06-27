import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, DataTable, EmptyState } from "../../../_components/ds";
import { getProcurementIndents } from "../../../_data/loaders";
import { formatIndianDate } from "@/lib/formatters";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Pending Approval",
  approved: "Approved",
  rejected: "Rejected",
  converted_to_po: "Converted to PO",
};

type IndentRow = {
  id: string;
  indentNo: string;
  requestedBy: string;
  department: string;
  itemCount: number;
  estimatedAmount: number;
  requestDate: string;
  requiredByDate: string;
  status: string;
} & Record<string, unknown>;

export default async function IndentsPage() {
  const { data: indents, source } = await getProcurementIndents({ limit: 500 });

  const pendingApproval = indents.filter((i) => i.status === "pending_approval").length;
  const approved = indents.filter((i) => i.status === "approved").length;
  const converted = indents.filter((i) => i.status === "converted_to_po").length;

  const rows: IndentRow[] = indents.map((i) => ({
    id: i.id,
    indentNo: i.indentNo,
    requestedBy: i.requestedBy,
    department: i.department,
    itemCount: i.itemCount,
    estimatedAmount: i.estimatedAmount,
    requestDate: formatIndianDate(i.requestDate),
    requiredByDate: i.requiredByDate ? formatIndianDate(i.requiredByDate) : "—",
    status: STATUS_LABELS[i.status] ?? i.status,
  }));

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
        {source === "error" ? (
          <EmptyState
            icon="⚠️"
            title="Couldn’t load indents"
            message="The procurement service didn’t respond. Check your connection and try again."
            action={<Link href="/procurement/indents" className="btn ghost">Retry</Link>}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="📋"
            title="No indents yet"
            message="An indent is a request to buy goods or services. Create your first one to start a purchase."
            action={<Link href="/procurement/indents/new" className="btn primary">+ New Indent</Link>}
          />
        ) : (
          <DataTable<IndentRow>
            rows={rows}
            rowLinkKey="id"
            rowLinkPrefix="/procurement/indents/"
            sortable
            filterable
            filterPlaceholder="Filter by indent no, department, requester…"
            pageSize={10}
            columns={[
              { key: "indentNo", label: "Indent No" },
              { key: "requestedBy", label: "Requested By" },
              { key: "department", label: "Department" },
              { key: "itemCount", label: "Items", align: "right" },
              { key: "estimatedAmount", label: "Est. Amount", align: "right", cellType: "amount" },
              { key: "requestDate", label: "Request Date" },
              { key: "requiredByDate", label: "Required By" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
          />
        )}
      </Card>
    </>
  );
}
