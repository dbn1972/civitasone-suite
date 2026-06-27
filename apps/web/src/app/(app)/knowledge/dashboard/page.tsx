import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getKnowledgeDocs } from "../../../_data/loaders";
import { DataTable, EmptyState, PageHeader, StatCard, StatGrid, StatusPill } from "../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";

const BAR_W = 640;
const BAR_H = 150;
const BAR_PAD = 10;
const BAR_GAP = 6;
const LABEL_H = 16;

function CategoryBarChart({ categories }: { categories: { name: string; count: number }[] }) {
  const items = categories.slice(0, 7);
  if (items.length === 0) return null;

  const maxVal = Math.max(...items.map((c) => c.count), 1);
  const n = items.length;
  const barW = Math.floor((BAR_W - BAR_PAD * 2 - BAR_GAP * (n - 1)) / n);
  const chartH = BAR_H - LABEL_H;

  return (
    <svg width="100%" viewBox={`0 0 ${BAR_W} ${BAR_H}`} aria-label="Documents by category bar chart" role="img">
      {items.map((cat, i) => {
        const ratio = cat.count / maxVal;
        const barH = Math.max(4, Math.round(ratio * (chartH - 6)));
        const x = BAR_PAD + i * (barW + BAR_GAP);
        const y = chartH - barH;
        const opacity = 0.45 + (i / Math.max(n - 1, 1)) * 0.5;
        const label = cat.name.length > 10 ? cat.name.slice(0, 9) + "…" : cat.name;
        return (
          <g key={cat.name}>
            <rect x={x} y={y} width={barW} height={barH} rx={4} fill="#ca8a04" opacity={opacity} />
            <text x={x + barW / 2} y={BAR_H - 2} textAnchor="middle" fontSize={9} fill="#98a2b3">
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function StorageDonut({ usedPct }: { usedPct: number }) {
  const r = 53;
  const cx = 66;
  const cy = 66;
  const circ = 2 * Math.PI * r;
  const filled = (usedPct / 100) * circ;
  const offset = circ - filled;

  return (
    <svg width={132} height={132} viewBox="0 0 132 132" aria-label={`Storage usage: ${usedPct.toFixed(0)}% of quota`} role="img">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#eef0f4" strokeWidth={13} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#ca8a04" strokeWidth={13}
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`} />
      <text x="50%" y="46%" textAnchor="middle" dy=".1em" fontSize={22} fontWeight={780} fill="#101828">
        {usedPct.toFixed(0)}%
      </text>
      <text x="50%" y="63%" textAnchor="middle" fontSize={9.5} fill="#98a2b3">of quota</text>
    </svg>
  );
}

function docStatusLabel(s: string) {
  if (s === "approved") return "Published";
  if (s === "under_review") return "Under review";
  if (s === "draft") return "Draft";
  if (s === "archived") return "Archived";
  return s;
}

type RecentDocRow = {
  id: string;
  title: string;
  category: string;
  author: string;
  createdAt: string;
  statusLabel: string;
  statusPill: string;
};

export default async function KnowledgeDashboardPage() {
  const { data: docs, source } = await getKnowledgeDocs();

  const total = docs.length;
  const circulars = docs.filter((d) => d.category?.toLowerCase().includes("circular")).length;
  const underRetention = docs.filter((d) => d.status === "approved" || d.status === "under_review").length;
  const dueForArchival = docs.filter((d) => d.status === "archived").length;

  const categoryMap = docs.reduce<Record<string, number>>((acc, d) => {
    acc[d.category] = (acc[d.category] ?? 0) + 1;
    return acc;
  }, {});
  const categoryList = Object.entries(categoryMap)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const storagePct = total > 0 ? Math.min(100, Math.round((total / 500) * 100)) : 0;

  const recentRows: RecentDocRow[] = [...docs]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5)
    .map((doc) => ({
      id: doc.id,
      title: doc.title,
      category: doc.category,
      author: doc.author ?? "—",
      createdAt: formatIndianDate(doc.createdAt),
      statusLabel: docStatusLabel(doc.status),
      statusPill: doc.status === "approved" ? "approved" : doc.status,
    }));

  return (
    <div className="wrap">
      {source === "error" && <DataSourceBadge source={source} />}
      <PageHeader
        title="Knowledge &amp; Document Management"
        subtitle="Digital repository, records retention &amp; enterprise search."
        actions={
          <>
            <Link href="/knowledge/documents/new?bulk=true" className="btn ghost" style={{ minHeight: 44 }}>Bulk upload</Link>
            <Link href="/knowledge/documents/new" className="btn primary" style={{ minHeight: 44 }}>+ Publish Document</Link>
          </>
        }
      />

      <StatGrid>
        <StatCard icon="📂" iconBg="#fef9e7" label="Documents" value={total.toLocaleString("en-IN")} />
        <StatCard icon="📜" iconBg="#eff6ff" label="Circulars/Policies" value={circulars.toLocaleString("en-IN")} />
        <StatCard icon="🗃️" iconBg="#ecfdf3" label="Under Retention" value={underRetention.toLocaleString("en-IN")} />
        <StatCard icon="📦" iconBg="#fffaeb" label="Due for Archival" value={dueForArchival.toLocaleString("en-IN")} />
      </StatGrid>

      {total === 0 ? (
        <EmptyState
          icon="📂"
          title="No documents yet"
          message="No documents in the repository yet."
        />
      ) : (
        <div className="grid g-main" style={{ marginTop: "18px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
            <div className="card">
              <div className="card-h">
                <h3>Recent publications</h3>
                <Link className="lnk" href="/knowledge/repository">Repository →</Link>
              </div>
              <DataTable<RecentDocRow>
                columns={[
                  { key: "title", label: "Document" },
                  { key: "category", label: "Type" },
                  { key: "author", label: "Dept" },
                  { key: "createdAt", label: "Date" },
                  {
                    key: "statusLabel",
                    label: "Status",
                    render: (row) => <StatusPill status={row.statusPill} label={row.statusLabel} />,
                  },
                ]}
                rows={recentRows}
                sortable
                filterable
                pageSize={15}
              />
            </div>

            <div className="card">
              <div className="card-h"><h3>Documents by category</h3></div>
              <div className="pad"><CategoryBarChart categories={categoryList} /></div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
            <div className="card">
              <div className="card-h"><h3>Storage</h3></div>
              <div className="pad" style={{ display: "grid", placeItems: "center" }}>
                <StorageDonut usedPct={storagePct} />
              </div>
            </div>

            <div className="card">
              <div className="card-h"><h3>Quick search</h3></div>
              <div className="pad">
                <div className="tb-search" style={{ maxWidth: "none" }}>
                  <span aria-hidden="true">🔎</span>
                  <input aria-label="Quick search (open full search to type)" placeholder="Search circulars, policies…" readOnly />
                </div>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "12px" }}>
                  {["travel policy", "reservation", "GFR 2017"].map((term) => (
                    <Link key={term} href={`/knowledge/search?q=${encodeURIComponent(term)}`} className="chip" style={{ textDecoration: "none" }}>
                      {term}
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
