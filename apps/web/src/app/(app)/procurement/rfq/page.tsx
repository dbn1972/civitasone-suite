import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, DataTable, EmptyState } from "../../../_components/ds";
import { getRFQs } from "../../../_data/loaders";
import { formatIndianDate } from "@/lib/formatters";

type RFQRow = {
  id: string;
  rfqNo: string;
  title: string;
  indentRef: string;
  vendorsInvited: number;
  responsesReceived: number;
  closingDate: string;
  status: string;
} & Record<string, unknown>;

export default async function RFQPage() {
  const { data: rfqs, source } = await getRFQs();

  const issued = rfqs.filter((r) => r.status === "issued").length;
  const totalResponses = rfqs.reduce((sum, r) => sum + r.responsesReceived, 0);
  const awarded = rfqs.filter((r) => r.status === "awarded").length;

  const rows: RFQRow[] = rfqs.map((r) => ({
    id: r.id,
    rfqNo: r.rfqNo,
    title: r.title,
    indentRef: r.indentRef ?? "—",
    vendorsInvited: r.vendorsInvited,
    responsesReceived: r.responsesReceived,
    closingDate: formatIndianDate(r.closingDate),
    status: r.status,
  }));

  return (
    <>
      <PageHeader
        title="Request for Quotation"
        subtitle="Manage RFQs issued to vendors and track responses received."
        actions={
          <>
            <Link href="/procurement/rfq/new?template=1" className="btn ghost">Templates</Link>
            <Link href="/procurement/rfq/new" className="btn primary">+ New RFQ</Link>
            {source === "error" ? <DataSourceBadge source={source} message="Couldn't load — showing nothing" /> : null}
          </>
        }
      />

      <StatGrid>
        <StatCard icon="📝" iconBg="#e7edfd" label="Total RFQs" value={rfqs.length} />
        <StatCard icon="📤" iconBg="#eff6ff" label="Issued" value={issued} />
        <StatCard icon="📥" iconBg="#ecfdf3" label="Responses" value={totalResponses} />
        <StatCard icon="🏆" iconBg="#fffaeb" label="Awarded" value={awarded} />
      </StatGrid>

      <Card title="Requests for quotation">
        {source === "error" ? (
          <EmptyState
            icon="⚠️"
            title="Couldn’t load RFQs"
            message="The RFQ service didn’t respond. Check your connection and try again."
            action={<Link href="/procurement/rfq" className="btn ghost">Retry</Link>}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="📝"
            title="No RFQs found"
            message="Create a new RFQ to start collecting vendor quotes."
            action={<Link href="/procurement/rfq/new" className="btn primary">+ New RFQ</Link>}
          />
        ) : (
          <DataTable<RFQRow>
            rows={rows}
            rowLinkKey="id"
            rowLinkPrefix="/procurement/rfq/"
            sortable
            filterable
            filterPlaceholder="Filter by RFQ no, title, status…"
            pageSize={10}
            columns={[
              { key: "rfqNo", label: "RFQ No" },
              { key: "title", label: "Title" },
              { key: "indentRef", label: "Indent Ref" },
              { key: "vendorsInvited", label: "Invited", align: "right" },
              { key: "responsesReceived", label: "Responses", align: "right" },
              { key: "closingDate", label: "Closing Date" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
          />
        )}
      </Card>
    </>
  );
}
