import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, DataTable, EmptyState } from "../../../_components/ds";
import { getProcurementTenders } from "../../../_data/loaders";
import { formatIndianDate } from "@/lib/formatters";

const TYPE_LABELS: Record<string, string> = {
  open: "Open",
  limited: "Limited",
  single_source: "Single Source",
  gem: "GeM",
};

type TenderRow = {
  id: string;
  tenderNo: string;
  title: string;
  typeLabel: string;
  estimatedValue: number;
  publishDate: string;
  bidClosingDate: string;
  bidsReceived: number;
  status: string;
} & Record<string, unknown>;

export default async function TendersPage() {
  const { data: tenders, source } = await getProcurementTenders();

  const published = tenders.filter((t) => t.status === "published").length;
  const underEvaluation = tenders.filter((t) => t.status === "evaluation").length;
  const awarded = tenders.filter((t) => t.status === "awarded").length;

  const rows: TenderRow[] = tenders.map((t) => ({
    id: t.id,
    tenderNo: t.tenderNo,
    title: t.title,
    typeLabel: TYPE_LABELS[t.type] ?? t.type,
    estimatedValue: t.estimatedValue,
    publishDate: t.publishDate ? formatIndianDate(t.publishDate) : "—",
    bidClosingDate: formatIndianDate(t.bidClosingDate),
    bidsReceived: t.bidsReceived,
    status: t.status,
  }));

  return (
    <>
      <PageHeader
        title="Tender Management"
        subtitle="Manage open, limited, and GeM tenders with bid tracking."
        actions={
          <>
            <a
              className="btn ghost"
              href="https://eprocure.gov.in/cppp/"
              target="_blank"
              rel="noopener noreferrer"
            >
              CPPP Portal<span aria-hidden="true"> ↗</span>
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            <Link href="/procurement/tenders/new" className="btn primary">+ New Tender</Link>
            {source === "error" ? <DataSourceBadge source={source} /> : null}
          </>
        }
      />

      <StatGrid>
        <StatCard icon="🏛️" iconBg="#e7edfd" label="Total Tenders" value={tenders.length} />
        <StatCard icon="📢" iconBg="#ecfdf3" label="Published" value={published} />
        <StatCard icon="🔍" iconBg="#fffaeb" label="Under Evaluation" value={underEvaluation} />
        <StatCard icon="🏆" iconBg="#eff6ff" label="Awarded" value={awarded} />
      </StatGrid>

      <Card title="Tenders register">
        {source === "error" ? (
          <EmptyState
            icon="⚠️"
            title="Couldn’t load tenders"
            message="The tender service didn’t respond. Check your connection and try again."
            action={<Link href="/procurement/tenders" className="btn ghost">Retry</Link>}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="🏛️"
            title="No tenders found"
            message="Create a new tender to start the procurement process."
            action={<Link href="/procurement/tenders/new" className="btn primary">+ New Tender</Link>}
          />
        ) : (
          <DataTable<TenderRow>
            rows={rows}
            rowLinkKey="id"
            rowLinkPrefix="/procurement/tenders/"
            sortable
            filterable
            filterPlaceholder="Filter by tender no, title, status…"
            pageSize={10}
            columns={[
              { key: "tenderNo", label: "Tender No" },
              { key: "title", label: "Title" },
              { key: "typeLabel", label: "Type" },
              { key: "estimatedValue", label: "Est. Value", align: "right", cellType: "amount" },
              { key: "publishDate", label: "Published" },
              { key: "bidClosingDate", label: "Bid Close" },
              { key: "bidsReceived", label: "Bids", align: "right" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
          />
        )}
      </Card>
    </>
  );
}
