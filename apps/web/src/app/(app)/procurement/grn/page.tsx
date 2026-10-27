import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, DataTable, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { getTranslations } from "next-intl/server";
import { getProcurementGRNs, getProcurementGRNSummary } from "../../../_data/loaders";
import { formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { matchState, MATCH_LABELS, MATCH_PILL_STATUS, MATCH_STATUS_LABELS, GRN_STATUS_LABELS } from "./statusLabels";
import { parsePoRef } from "./poRef";

// GAP-PROCUREMENT-GRN-02 — the register pages on the SERVER (limit/offset from
// the URL) and takes its stat cards and pager totals from the server's true
// status-count summary, so neither the figures nor the search are limited to
// the rows the browser happens to hold.
const PAGE_SIZE = 25;

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

function readParam(searchParams: Record<string, string | string[] | undefined> | undefined, key: string): string | undefined {
  const v = searchParams?.[key];
  return Array.isArray(v) ? v[0] : v;
}

export default async function GRNPage(
  props: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {},
) {
  const t = await getTranslations("procurement.w2.grn");
  const searchParams = await props.searchParams;
  const pageParam = Number(readParam(searchParams, "page") ?? "1");
  const pageNo = Number.isFinite(pageParam) && pageParam >= 1 ? Math.floor(pageParam) : 1;
  const q = readParam(searchParams, "q")?.trim().slice(0, 100) || undefined;
  const offset = (pageNo - 1) * PAGE_SIZE;

  // The stat cards always describe the whole store; with a search active a second
  // summary gives the match count that drives the pager.
  const [{ data: grns, source }, { data: overall }, matched] = await Promise.all([
    getProcurementGRNs({ limit: PAGE_SIZE, offset, q }),
    getProcurementGRNSummary(),
    q ? getProcurementGRNSummary({ q }) : Promise.resolve(null),
  ]);

  // GAP-PROCUREMENT-GRN-03 — on a failed fetch the loader returns [], so these
  // counts would be genuine-looking zeros. Gate every figure on `errored` and
  // show "—" (not a fabricated 0) exactly as the procurement dashboard does. A
  // missing summary reads "—" too: unknown is never shown as zero.
  const errored = source === "error";
  const stat = (n: number | undefined): number | null => (errored || n === undefined ? null : n);
  // The match count for the active search, else the whole-store total.
  const total = q ? matched?.data?.total : overall?.total;
  const hasNext = total !== undefined ? offset + grns.length < total : grns.length === PAGE_SIZE;

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

  const pageHref = (n: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (n > 1) params.set("page", String(n));
    const qs = params.toString();
    return qs ? `/procurement/grn?${qs}` : "/procurement/grn";
  };
  // Shown under the rows AND under the empty state, so a page past the end can always step back.
  const pager = (hasNext || pageNo > 1) ? (
    <nav aria-label={t("pagerLabel")} style={{ display: "flex", gap: 8, alignItems: "center", marginBlockStart: 10 }}>
      {pageNo > 1 ? <Link className="btn ghost" href={pageHref(pageNo - 1)}>{t("previous")}</Link> : null}
      <span aria-live="polite" style={{ fontSize: 13, color: "var(--mut)" }}>{t("page", { n: pageNo })}</span>
      {hasNext ? <Link className="btn ghost" href={pageHref(pageNo + 1)}>{t("next")}</Link> : null}
    </nav>
  ) : null;

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
        <StatCard icon="📦" tone="info" label="Total GRNs" value={stat(overall?.total)} />
        <StatCard icon="✅" tone="good" label="Accepted" value={stat(overall?.accepted)} />
        <StatCard icon="🔍" tone="warn" label="Awaiting inspection" value={stat(overall?.awaitingInspection)} />
        <StatCard icon="❌" tone="bad" label="Rejected" value={stat(overall?.rejected)} />
      </StatGrid>

      {/* GAP-PROCUREMENT-GRN-02: server-side search, so a GRN outside the current page is found. */}
      <form method="get" role="search" aria-label={t("searchLabel")} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "0 0 12px" }}>
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          maxLength={100}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchLabel")}
          className="inp"
          style={{ minInlineSize: 260 }}
        />
        <button type="submit" className="btn">{t("search")}</button>
        {q ? <Link href="/procurement/grn" className="btn ghost">{t("clearSearch")}</Link> : null}
        {q && total !== undefined ? <span role="status" style={{ fontSize: 13, color: "var(--mut)" }}>{t("matchCount", { count: total })}</span> : null}
      </form>

      <Card title="Goods receipt notes">
        {source === "error" ? (
          // GAP-PROCUREMENT-GRN-03 — RefreshErrorState (not ErrorState) so the
          // officer gets a Retry action, matching the stat cards reading "—".
          <RefreshErrorState error={toHumanError("load", { area: "GRNs" })} backHref="/procurement/grn" />
        ) : rows.length === 0 ? (
          <>
            <EmptyState
              icon="📦"
              title={pageNo > 1 ? t("noPageTitle") : q ? t("noMatchTitle") : "No goods received yet"}
              message={pageNo > 1
                ? t("noPageMessage")
                : q
                  ? t("noMatchMessage")
                  : "A Goods Received Note (GRN) is the check you do when a delivery arrives against an order. Create one when goods come in."}
              action={q || pageNo > 1
                ? <Link href="/procurement/grn" className="btn ghost">{t("clearSearch")}</Link>
                : <Link href="/procurement/grn/new" className="btn primary">+ New GRN</Link>}
            />
            {pager}
          </>
        ) : (
          <>
          <DataTable<GRNRow>
            rows={rows}
            rowLinkKey="id"
            rowLinkPrefix="/procurement/grn/"
            sortable
            pageSize={PAGE_SIZE}
            exportable exportAudit="procurement/grn"
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
          {pager}
          </>
        )}
      </Card>
    </>
  );
}
