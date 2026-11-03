import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, DataTable, EmptyState, ErrorState } from "../../../_components/ds";
import { getProcurementTenders } from "../../../_data/loaders";
import { formatIndianDate, todayIST } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";

const TYPE_LABELS: Record<string, string> = {
  open: "Open",
  limited: "Limited",
  single_source: "Single Source",
  gem: "GeM",
};

// GAP-PROCUREMENT-TENDERS-01 / 03: type filter options.
const TYPE_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All types" },
  { value: "open", label: "Open" },
  { value: "limited", label: "Limited" },
  { value: "single_source", label: "Single Source" },
  { value: "gem", label: "GeM" },
];

// GAP-PROCUREMENT-TENDERS-02 / 03: status filter options including the split
// evaluation phases.
const STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
  { value: "technical_evaluation", label: "Technical Evaluation" },
  { value: "financial_evaluation", label: "Financial Evaluation" },
  { value: "awarded", label: "Awarded" },
  { value: "cancelled", label: "Cancelled" },
];

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  published: "Published",
  evaluation: "Under Evaluation",
  technical_evaluation: "Technical Evaluation",
  financial_evaluation: "Financial Evaluation",
  awarded: "Awarded",
  cancelled: "Cancelled",
};

/** Why the register's Bids column is "—" (shown under the table). */
const BIDS_NOTE = "Bids: the number of bids is shown on each tender's page. The register does not have a reliable bid count, so it shows \u201c\u2014\u201d instead of a possibly wrong 0.";

type TenderRow = {
  id: string;
  tenderNo: string;
  title: string;
  typeLabel: string;
  // GAP-PROCUREMENT-TENDERS-01: raw type drives a warn pill for single_source.
  typeKey: string;
  estimatedValue: number;
  publishDate: string;
  bidClosingDate: string;
  /** Always "—" on the register: see BIDS_NOTE. */
  bidsReceived: string;
  status: string;
  // GAP-PROCUREMENT-TENDERS-03: overdue cue status word.
  bidWindow: string;
} & Record<string, unknown>;

export default async function TendersPage(
  props: {
    searchParams?: Promise<{ type?: string; status?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const { data: tenders, source } = await getProcurementTenders();

  const published = tenders.filter((t) => t.status === "published").length;
  // GAP-PROCUREMENT-TENDERS-02: count the two evaluation phases separately
  // (plus the legacy collapsed "evaluation").
  const technicalEval = tenders.filter((t) => t.status === "technical_evaluation").length;
  const financialEval = tenders.filter(
    (t) => t.status === "financial_evaluation" || t.status === "evaluation",
  ).length;
  const awarded = tenders.filter((t) => t.status === "awarded").length;
  const singleSource = tenders.filter((t) => t.type === "single_source").length;

  const today = todayIST();

  const typeFilter = searchParams?.type ?? "";
  const statusFilter = searchParams?.status ?? "";

  const filtered = tenders.filter((t) => {
    if (typeFilter && t.type !== typeFilter) return false;
    if (statusFilter && t.status !== statusFilter) return false;
    return true;
  });

  const rows: TenderRow[] = filtered.map((t) => {
    // GAP-PROCUREMENT-TENDERS-03: a published tender past its bid-close looks
    // identical to a fresh one — flag it. UAT Phase 1B review: the cue used to say
    // "Closed — 0 bids" from the list's bidsReceived counter, which
    // procurement-service does not maintain (0 for tenders that have bids), so it
    // now flags only what the register knows: the window closed and bids have
    // not been opened yet (the tender is still "published").
    const closed = t.bidClosingDate ? t.bidClosingDate < today : false;
    const bidWindow = t.status === "published" && closed ? "closed_awaiting_opening" : "open";
    return {
      id: t.id,
      tenderNo: t.tenderNo,
      title: t.title,
      typeLabel: TYPE_LABELS[t.type] ?? t.type,
      typeKey: t.type,
      estimatedValue: t.estimatedValue,
      publishDate: t.publishDate ? formatIndianDate(t.publishDate) : "—",
      bidClosingDate: formatIndianDate(t.bidClosingDate),
      // UAT Phase 1B review: the list API carries only the stale bids_received
      // counter (no bid array); the real count is on the tender's detail page,
      // which counts the bids themselves. Never show the counter's misleading 0.
      bidsReceived: "—",
      status: t.status,
      bidWindow,
    };
  });

  const link = (next: { type?: string; status?: string }) => {
    const params = new URLSearchParams();
    const type = next.type ?? typeFilter;
    const status = next.status ?? statusFilter;
    if (type) params.set("type", type);
    if (status) params.set("status", status);
    const qs = params.toString();
    return `/procurement/tenders${qs ? `?${qs}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Tender Management"
        subtitle="Manage open, limited, single-source, and GeM tenders with bid tracking."
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
            {source === "error" ? <DataSourceBadge source={source} message="Couldn't load — showing nothing" /> : null}
          </>
        }
      />

      <StatGrid>
        <StatCard icon="🏛️" tone="info" label="Total Tenders" value={tenders.length} href="/procurement/tenders" />
        <StatCard icon="📢" tone="good" label="Published" value={published} href={link({ status: "published", type: typeFilter })} />
        <StatCard icon="🔬" tone="warn" label="Technical Eval" value={technicalEval} href={link({ status: "technical_evaluation", type: typeFilter })} />
        <StatCard icon="💰" tone="warn" label="Financial Eval" value={financialEval} href={link({ status: "financial_evaluation", type: typeFilter })} />
        <StatCard icon="🏆" tone="good" label="Awarded" value={awarded} href={link({ status: "awarded", type: typeFilter })} />
        {/* GAP-PROCUREMENT-TENDERS-01: single-source is the audit-sensitive mode — surface and link it. */}
        <StatCard icon="⚠️" tone="bad" label="Single Source" value={singleSource} href={link({ type: "single_source", status: statusFilter })} hint="Single-source procurement is audit-sensitive and requires recorded justification." />
      </StatGrid>

      <Card title="Tenders register">
        {source === "error" ? (
          <ErrorState error={toHumanError("load", { area: "tenders" })} backHref="/procurement/tenders" />
        ) : (
          <>
            {/* GAP-PROCUREMENT-TENDERS-03/04: type + status facet controls. */}
            <form method="get" style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12, alignItems: "flex-end" }}>
              <label className="field" style={{ minWidth: 180 }}>
                <span className="label">Type</span>
                <select name="type" defaultValue={typeFilter} style={{ minHeight: 44 }}>
                  {TYPE_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label className="field" style={{ minWidth: 200 }}>
                <span className="label">Status</span>
                <select name="status" defaultValue={statusFilter} style={{ minHeight: 44 }}>
                  {STATUS_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <button type="submit" className="btn ghost" style={{ minHeight: 44 }}>Apply</button>
              {(typeFilter || statusFilter) ? (
                <Link href="/procurement/tenders" className="btn ghost" style={{ minHeight: 44 }}>Clear</Link>
              ) : null}
            </form>

            {rows.length === 0 ? (
              <EmptyState
                icon="🏛️"
                title="No tenders found"
                message={typeFilter || statusFilter ? "No tenders match the current filters." : "Create a new tender to start the procurement process."}
                action={<Link href="/procurement/tenders/new" className="btn primary">+ New Tender</Link>}
              />
            ) : (
              <DataTable<TenderRow>
                rows={rows}
                rowLinkKey="id"
                rowLinkPrefix="/procurement/tenders/"
                identifyingColumnKey="tenderNo"
                sortable
                filterable
                filterPlaceholder="Filter by tender no, title, status…"
                pageSize={10}
                columns={[
                  { key: "tenderNo", label: "Tender No" },
                  { key: "title", label: "Title" },
                  // GAP-PROCUREMENT-TENDERS-01: single_source renders a warn pill.
                  {
                    key: "typeKey",
                    label: "Type",
                    cellType: "status",
                    statusLabels: TYPE_LABELS,
                  },
                  // UAT Phase 1B: procurement-service sends estimatedValue already in RUPEES
                  // (estimated_minor / 100, tender/queries.ts). cellType "amount" divided it by 100
                  // again, so every value read 100x too small.
                  { key: "estimatedValue", label: "Est. Value", align: "right", cellType: "rupees" },
                  { key: "publishDate", label: "Published" },
                  { key: "bidClosingDate", label: "Bid Close" },
                  { key: "bidsReceived", label: "Bids", align: "right", sortable: false, csvExclude: true },
                  // GAP-PROCUREMENT-TENDERS-03: overdue cue column.
                  {
                    key: "bidWindow",
                    label: "Bid Window",
                    cellType: "status",
                    statusLabels: { open: "Open", closed_awaiting_opening: "Closed — bids not yet opened" },
                    statusVariants: { closed_awaiting_opening: "bad" },
                  },
                  { key: "status", label: "Status", cellType: "status", statusLabels: STATUS_LABELS },
                ]}
              />
            )}
            {rows.length > 0 ? (
              <p role="note" id="tender-bids-note" style={{ margin: "8px 0 0", fontSize: 13, color: "var(--ink2)" }}>
                {BIDS_NOTE}
              </p>
            ) : null}
          </>
        )}
      </Card>
    </>
  );
}
