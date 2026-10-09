import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, DataTable, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { getProcurementGRNs } from "../../../_data/loaders";
import { formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { isAwaitingInspection, matchState, MATCH_LABELS, MATCH_PILL_STATUS, MATCH_STATUS_LABELS, GRN_STATUS_LABELS } from "./statusLabels";
import { parsePoRef } from "./poRef";

// GAP-PROCUREMENT-GRN-02 — the API cap. Until server-side pagination with a
// true total/summary is wired in, the list fetches at most this many rows and
// labels the stats as partial when the cap is hit (see the truncation notice
// below) so the stat cards never silently under-report for a large store.
const LIST_LIMIT = 500;

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
  const { data: grns, source } = await getProcurementGRNs({ limit: LIST_LIMIT });

  // GAP-PROCUREMENT-GRN-03 — on a failed fetch the loader returns [], so these
  // counts would be genuine-looking zeros. Gate every figure on `errored` and
  // show "—" (not a fabricated 0) exactly as the procurement dashboard does.
  const errored = source === "error";
  const accepted = grns.filter((g) => g.status === "accepted").length;
  // GAP-PROCUREMENT-GRN-01 — "Awaiting inspection" now counts every pre-decision
  // state (draft, under_inspection, received, quality_check) instead of only
  // quality_check/received, so a GRN under inspection is no longer invisible.
  const pendingQC = grns.filter((g) => isAwaitingInspection(g.status)).length;
  const rejected = grns.filter((g) => g.status === "rejected" || g.status === "partially_rejected").length;

  // GAP-PROCUREMENT-GRN-02 — interim truncation cue: if we got exactly the cap
  // back there may be more rows the stats don't reflect.
  const truncated = !errored && grns.length === LIST_LIMIT;

  const rows: GRNRow[] = grns.map((g) => {
    const ms = matchState(g.threeWayMatch);
    return {
      id: g.id,
      grnNo: g.grnNo,
      // GAP2-PROCUREMENT-GRN-DETAIL-06 — show the human PO number (resolved
      // server-side), never the opaque `procurement_po:<uuid>` composite. Fall
      // back to the bare uuid (prefix stripped) and finally "—" when absent.
      poRef: g.poNo ?? parsePoRef(g.poRef) ?? "—",
      vendor: g.vendor,
      receivedDate: formatIndianDate(g.receivedDate),
      itemCount: g.itemCount,
      // GAP-PROCUREMENT-GRN-04 — coloured match pill (text label kept so status
      // never depends on colour alone); uninspected GRNs read "Pending", the
      // same neutral state the detail page now shows.
      match: MATCH_LABELS[ms],
      matchStatus: MATCH_PILL_STATUS[ms],
      status: g.status,
    };
  });

  return (
    <>
      <PageHeader
        title="Goods Receipt Notes"
        subtitle="Record and track goods received against purchase orders."
        help="procurement"
        actions={
          <>
            <Link href="/procurement/grn/new" className="btn primary">+ New GRN</Link>
            {source === "error" ? <DataSourceBadge source={source} message="Couldn't load — showing nothing" /> : null}
          </>
        }
      />

      <StatGrid>
        <StatCard icon="📦" iconBg="#e7edfd" label="Total GRNs" value={errored ? "—" : grns.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Accepted" value={errored ? "—" : accepted} />
        <StatCard icon="🔍" iconBg="#fffaeb" label="Awaiting inspection" value={errored ? "—" : pendingQC} />
        <StatCard icon="❌" iconBg="#fef3f2" label="Rejected" value={errored ? "—" : rejected} />
      </StatGrid>

      {truncated ? (
        <p role="status" style={{ margin: "0 0 12px", fontSize: "0.875rem", color: "var(--warn, #b45309)" }}>
          Showing the first {LIST_LIMIT} GRNs — refine your filters to find others. The totals above
          count only the GRNs shown.
        </p>
      ) : null}

      <Card title="Goods receipt notes">
        {source === "error" ? (
          // GAP-PROCUREMENT-GRN-03 — RefreshErrorState (not ErrorState) so the
          // officer gets a Retry action, matching the stat cards reading "—".
          <RefreshErrorState error={toHumanError("load", { area: "GRNs" })} backHref="/procurement/grn" />
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
            exportable
            columns={[
              { key: "grnNo", label: "GRN No" },
              { key: "poRef", label: "PO Ref" },
              { key: "vendor", label: "Vendor" },
              { key: "receivedDate", label: "Received Date" },
              { key: "itemCount", label: "Items", align: "right" },
              // GAP-PROCUREMENT-GRN-04 — coloured pill with a text label (never
              // colour-only); `matchStatus` carries the pill key, MATCH_LABELS
              // the human text.
              { key: "matchStatus", label: "Match", cellType: "status", statusLabels: MATCH_STATUS_LABELS },
              { key: "status", label: "Status", cellType: "status", statusLabels: GRN_STATUS_LABELS },
            ]}
          />
        )}
      </Card>
    </>
  );
}
