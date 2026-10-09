import Link from "next/link";
import { PageHeader, StatCard } from "../../../_components/ds";
import { todayIST } from "@/lib/formatters";
import { getCourtOrdersPage } from "../../../_data/loaders";
import { CourtOrdersTable } from "./CourtOrdersTable";

const PAGE_SIZE = 25;

function toPositiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

// GAP2-LEGAL-COURT-ORDERS-11: map the URL `filter` param to the table's
// segmented-control value so "Contempt watch" (?filter=risk) actually shows
// the at-risk view on first render.
function toInitialFilter(value: string | undefined): "All" | "Due" | "Risk" {
  if (value === "risk") return "Risk";
  if (value === "due") return "Due";
  return "All";
}

export default async function CourtOrdersPage({
  searchParams,
}: {
  searchParams: { page?: string; filter?: string };
}) {
  const page = Math.max(toPositiveInt(searchParams.page, 1), 1);
  const offset = (page - 1) * PAGE_SIZE;
  const { data, source } = await getCourtOrdersPage({ limit: PAGE_SIZE, offset });
  const { items, total: totalRows, stats } = data;

  const initialFilter = toInitialFilter(searchParams.filter);

  // GAP-LEGAL-COURT-ORDERS-03: use the IST calendar date so an order due
  // "today" in India is not mis-counted as overdue between 00:00–05:30 IST.
  const today = todayIST();

  // GAP2-LEGAL-COURT-ORDERS-10: the compliance KPIs come from the server-side
  // aggregate over the FULL tenant set, NOT the (capped) page slice, so
  // "Contempt Risk" is not silently undercounted at >50 orders.
  const total = stats.total;
  const pendingCompliance = stats.pendingCompliance;
  const complied = stats.complied;
  const contemptRisk = stats.contemptRisk;

  // GAP-LEGAL-COURT-ORDERS-03: on a load error, show "—" instead of a
  // falsely confident 0 in the stat tiles.
  const dash = (n: number): number | string => (source === "error" ? "—" : n);

  const from = totalRows === 0 ? 0 : offset + 1;
  const to = Math.min(offset + items.length, totalRows);
  const hasPrev = page > 1;
  const hasNext = offset + items.length < totalRows;
  const linkTo = (p: number) => {
    const sp = new URLSearchParams();
    if (searchParams.filter) sp.set("filter", searchParams.filter);
    sp.set("page", String(p));
    return `/legal/court-orders?${sp.toString()}`;
  };

  return (
    <div className="wrap">
      <div className="banner" style={{ background: "var(--panel)", border: "1px solid var(--line)", color: "var(--ink2)", borderRadius: 12, padding: "13px 16px", marginBottom: 18, fontSize: 13 }}>
        <b>Order compliance</b> is routed to the owning department; non-compliance risks contempt.
      </div>
      <PageHeader
        title="Court Order Compliance"
        subtitle="Track implementation of court orders & judgments."
        actions={
          <>
            {/* GAP-LEGAL-COURT-ORDERS-04: real link to the at-risk view instead
                of a disabled "coming soon" placeholder.
                GAP2-LEGAL-COURT-ORDERS-11: the ?filter=risk param is now read
                by the page and seeded into the table so the link actually
                shows the at-risk view. */}
            <Link href="/legal/court-orders?filter=risk" className="btn ghost">Contempt watch</Link>
            <Link href="/legal/court-orders/new" className="btn primary">+ Record Order</Link>
          </>
        }
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="📜" iconBg="var(--line2)" label="Orders Tracked" value={dash(total)} />
        <StatCard icon="⏰" iconBg="var(--warnbg)" label="Compliance Due" value={dash(pendingCompliance)} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label="Complied" value={dash(complied)} />
        <StatCard icon="⚠️" iconBg="var(--badbg)" label="Contempt Risk" value={dash(contemptRisk)} />
      </div>
      <CourtOrdersTable items={items} today={today} source={source} initialFilter={initialFilter} />
      {source !== "error" && (hasPrev || hasNext) && (
        <nav
          aria-label="Court order pages"
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}
        >
          {hasPrev ? (
            <Link className="btn ghost sm" href={linkTo(page - 1)} rel="prev">← Previous</Link>
          ) : (
            <span />
          )}
          <span style={{ fontSize: 13, color: "var(--ink2)" }}>
            Showing {from.toLocaleString("en-IN")}–{to.toLocaleString("en-IN")} of {totalRows.toLocaleString("en-IN")}
          </span>
          {hasNext ? (
            <Link className="btn ghost sm" href={linkTo(page + 1)} rel="next">Next →</Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
