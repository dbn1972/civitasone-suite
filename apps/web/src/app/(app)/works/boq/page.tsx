import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { formatMoney } from "@/lib/formatters";
import { getBoqItems, getBoqIndexSummary } from "../_data/loaders";
import { BoqTable } from "./BoqTable";

export default async function BoqPage() {
  const [{ data: items, source }, { data: summary }] = await Promise.all([
    getBoqItems(),
    getBoqIndexSummary(),
  ]);

  // GAP-WORKS-BOQ-02: the stat cards show the FULL-set figures from the list
  // response meta (count + paise-exact sum), not just the page the table
  // fetched — a partial money total on a finance card is misleading. When the
  // set is larger than the page we fetched, show a "showing first N" hint so a
  // reader knows the table itself is truncated even though the totals are not.
  const total = summary.total;
  const totalAmount = formatMoney(summary.totalAmountMinor);
  const truncated = summary.total > summary.fetched && summary.fetched > 0;
  const scopes = new Set(items.map((i) => String(i.scope ?? ""))).size;
  // GAP-WORKS-BOQ-04: count lines actually linked to a Schedule-of-Rates item
  // (srItemId present), not just any row that happens to carry an item code.
  const srLinked = items.filter((i) => typeof i.srItemId === "string" && i.srItemId.length > 0).length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      {/* UX-012: the data-source badge now lives inside BoqTable, driven by
          the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree with
          the table's own cache state (UX-002's pattern). */}
      <PageHeader
        title="Bill of Quantities"
        subtitle="SR items, measurements, and recapitulation for works."
        back="/works"
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Link
              href="/works/boq/new"
              className="btn primary"
              style={{ minHeight: 36, fontSize: 13, padding: "6px 14px" }}
            >
              + Add BoQ item
            </Link>
          </div>
        }
      />
      <StatGrid>
        <StatCard icon="📐" iconBg="#eff6ff" label="Total Items" value={total} />
        <StatCard icon="💰" iconBg="#ecfdf3" label="Total Amount" value={totalAmount} />
        <StatCard icon="📊" iconBg="#fffaeb" label="Scopes (shown)" value={scopes} />
        <StatCard
          icon="📋"
          iconBg="#f0fdf4"
          label="SR Items (shown)"
          hint="Lines linked to a Schedule of Rates item, among the rows shown below."
          value={srLinked}
        />
      </StatGrid>
      {truncated ? (
        <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 12px" }} role="note">
          Showing the first {summary.fetched} of {summary.total} BoQ items. Totals above cover all {summary.total}.
        </p>
      ) : null}
      <Card title="BoQ Items">
        <BoqTable items={items} source={source === "error" ? "error" : "api"} />
      </Card>
    </div>
  );
}
