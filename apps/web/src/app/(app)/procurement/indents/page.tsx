import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, DataTable, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { getProcurementIndents } from "../../../_data/loaders";
import { formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Pending Approval",
  tender_required: "Tender Required",
  approved: "Approved",
  rejected: "Rejected",
  converted_to_po: "Converted to PO",
  closed: "Closed",
};

// GAP-PROCUREMENT-INDENTS-01: the loader (and the server list route) still cap
// a single response; we page through it with limit/offset from the URL and
// show an honest truncation cue when a full page comes back, rather than
// silently dropping overflow rows for a busy department.
const PAGE_SIZE = 100;

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

function readParam(searchParams: Record<string, string | string[] | undefined> | undefined, key: string): string | undefined {
  const v = searchParams?.[key];
  return Array.isArray(v) ? v[0] : v;
}

export default async function IndentsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const pageParam = Number(readParam(searchParams, "page") ?? "1");
  const pageNo = Number.isFinite(pageParam) && pageParam >= 1 ? Math.floor(pageParam) : 1;
  const q = readParam(searchParams, "q")?.trim() || undefined;
  const statusFilter = readParam(searchParams, "status")?.trim() || undefined;
  const offset = (pageNo - 1) * PAGE_SIZE;

  const { data: indents, source } = await getProcurementIndents({ limit: PAGE_SIZE, offset, q });

  const errored = source === "error";
  // GAP-PROCUREMENT-INDENTS-01: this page is truncated when a full page came
  // back (there may be more rows the server didn't send).
  const truncated = !errored && indents.length === PAGE_SIZE;

  // GAP-PROCUREMENT-INDENTS-03: count every status that has a label, so the
  // actionable states (Tender Required especially) are visible, not just the
  // three the page used to show.
  const countOf = (status: string) => indents.filter((i) => i.status === status).length;

  // GAP-PROCUREMENT-INDENTS-03: optional client-chosen status narrowing.
  const filtered = statusFilter ? indents.filter((i) => i.status === statusFilter) : indents;

  // GAP-PROCUREMENT-INDENTS-02: on a failed load the stats must read "we don't
  // know" ("—"), not a fabricated 0. StatCard renders null as "—".
  const stat = (n: number): number | null => (errored ? null : n);

  const rows: IndentRow[] = filtered.map((i) => ({
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

  // Status filter links preserve the current search query.
  const statusHref = (status?: string) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    const qs = params.toString();
    return qs ? `/procurement/indents?${qs}` : "/procurement/indents";
  };

  return (
    <>
      <PageHeader
        title="Purchase Indents"
        subtitle="Track material requisitions from departments through to PO conversion."
        help="procurement"
        actions={
          <>
            <Link href="/procurement/indents/new" className="btn primary">+ New Indent</Link>
            {errored ? <DataSourceBadge source={source} message="Couldn't load — showing nothing" /> : null}
          </>
        }
      />

      <StatGrid>
        <StatCard icon="📋" tone="info" label="On this page" value={stat(indents.length)} hint="Indents in the current page of results" />
        <StatCard icon="⏳" tone="warn" label="Pending Approval" value={stat(countOf("pending_approval"))} href={statusHref("pending_approval")} />
        {/* GAP-PROCUREMENT-INDENTS-03: Tender Required is the actionable state — surface it next to Pending Approval and link to the filtered list. */}
        <StatCard icon="📣" tone="warn" label="Tender Required" value={stat(countOf("tender_required"))} href={statusHref("tender_required")} hint="Indents awaiting a tender to be floated" />
        <StatCard icon="✅" tone="good" label="Approved" value={stat(countOf("approved"))} href={statusHref("approved")} />
        <StatCard icon="📦" tone="info" label="Converted to PO" value={stat(countOf("converted_to_po"))} href={statusHref("converted_to_po")} />
        <StatCard icon="📝" tone="neutral" label="Draft" value={stat(countOf("draft"))} href={statusHref("draft")} />
        <StatCard icon="🚫" tone="bad" label="Rejected" value={stat(countOf("rejected"))} href={statusHref("rejected")} />
      </StatGrid>

      <Card title={statusFilter ? `Indents — ${STATUS_LABELS[statusFilter] ?? statusFilter}` : "All indents"}>
        {errored ? (
          // GAP-PROCUREMENT-INDENTS-02: a real retry (RefreshErrorState re-runs
          // the server fetch) instead of a dead ErrorState, and no 0-valued
          // stats masquerading as data above.
          <RefreshErrorState error={toHumanError("load", { area: "indents" })} backHref="/procurement/indents" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="📋"
            title={statusFilter ? "No indents in this status" : "No indents yet"}
            message={statusFilter
              ? "No indents match this status filter. Clear the filter to see all indents."
              : "An indent is a request to buy goods or services. Create your first one to start a purchase."}
            action={statusFilter
              ? <Link href={statusHref()} className="btn ghost">Clear filter</Link>
              : <Link href="/procurement/indents/new" className="btn primary">+ New Indent</Link>}
          />
        ) : (
          <>
            {/* GAP-PROCUREMENT-INDENTS-01: honest truncation cue + server paging controls. */}
            {truncated ? (
              <p role="note" style={{ fontSize: 13, color: "var(--warn)", margin: "0 0 10px" }}>
                Showing the first {PAGE_SIZE} indents on this page. Use the search box or the status counts above to narrow the list, or go to the next page.
              </p>
            ) : null}
            <DataTable<IndentRow>
              rows={rows}
              rowLinkKey="id"
              rowLinkPrefix="/procurement/indents/"
              sortable
              filterable
              filterPlaceholder="Filter by indent no, department, requester…"
              pageSize={10}
              exportable
              columns={[
                { key: "indentNo", label: "Indent No" },
                { key: "requestedBy", label: "Requested By" },
                { key: "department", label: "Department" },
                { key: "itemCount", label: "Items", align: "right" },
                { key: "estimatedAmount", label: "Est. Amount", align: "right", cellType: "amount" },
                { key: "requestDate", label: "Request Date" },
                { key: "requiredByDate", label: "Required By" },
                { key: "status", label: "Status", cellType: "status", statusLabels: STATUS_LABELS },
              ]}
            />
            {(truncated || pageNo > 1) ? (
              <nav className="dt-pager" aria-label="Indent pages" style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
                {pageNo > 1 ? (
                  <Link
                    className="btn ghost"
                    href={(() => { const p = new URLSearchParams(); if (q) p.set("q", q); if (statusFilter) p.set("status", statusFilter); if (pageNo - 1 > 1) p.set("page", String(pageNo - 1)); const s = p.toString(); return s ? `/procurement/indents?${s}` : "/procurement/indents"; })()}
                  >← Previous</Link>
                ) : null}
                <span aria-live="polite" style={{ fontSize: 13, color: "var(--mut)" }}>Page {pageNo}</span>
                {truncated ? (
                  <Link
                    className="btn ghost"
                    href={(() => { const p = new URLSearchParams(); if (q) p.set("q", q); if (statusFilter) p.set("status", statusFilter); p.set("page", String(pageNo + 1)); return `/procurement/indents?${p.toString()}`; })()}
                  >Next →</Link>
                ) : null}
              </nav>
            ) : null}
          </>
        )}
      </Card>
    </>
  );
}
