import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getKnowledgeDocs } from "../../../_data/loaders";
import { EmptyState, PageHeader, StatCard, StatGrid, RefreshErrorState } from "../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { RecentDocsTable, type RecentDocRow } from "./RecentDocsTable";

const BAR_W = 640;
const BAR_H = 150;
const BAR_PAD = 10;
const BAR_GAP = 6;
const LABEL_H = 16;

// GAP-KNOWLEDGE-DASHBOARD-06: use CSS variable for chart colour, add value labels,
// add <title> for truncated labels, and make aria-label summarise top categories.
function CategoryBarChart({ categories }: { categories: { name: string; count: number }[] }) {
  const items = categories.slice(0, 7);
  if (items.length === 0) return null; // ux-001-ok: pure chart renderer over an already-resolved category list; the parent page owns loading/error state

  const maxVal = Math.max(...items.map((c) => c.count), 1);
  const n = items.length;
  const barW = Math.floor((BAR_W - BAR_PAD * 2 - BAR_GAP * (n - 1)) / n);
  const chartH = BAR_H - LABEL_H;
  const summaryParts = items.slice(0, 3).map((c) => `${c.name}: ${c.count}`).join(", ");

  return (
    <svg width="100%" viewBox={`0 0 ${BAR_W} ${BAR_H}`} aria-label={`Documents by category: ${summaryParts}`} role="img">
      {items.map((cat, i) => {
        const ratio = cat.count / maxVal;
        const barH = Math.max(4, Math.round(ratio * (chartH - 6)));
        const x = BAR_PAD + i * (barW + BAR_GAP);
        const y = chartH - barH;
        const opacity = 0.45 + (i / Math.max(n - 1, 1)) * 0.5;
        const label = cat.name.length > 10 ? cat.name.slice(0, 9) + "…" : cat.name;
        return (
          <g key={cat.name}>
            <title>{`${cat.name}: ${cat.count}`}</title>
            <rect x={x} y={y} width={barW} height={barH} rx={4} fill="var(--brand, #4f46e5)" opacity={opacity} />
            <text x={x + barW / 2} y={y - 4} textAnchor="middle" fontSize={10} fill="var(--ink, #0f172a)" fontWeight={600}>
              {cat.count}
            </text>
            <text x={x + barW / 2} y={BAR_H - 2} textAnchor="middle" fontSize={9} fill="var(--mut, #667085)">
              {label}
            </text>
          </g>
        );
      })}
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

// GAP-KNOWLEDGE-HOME-02: unified module title as "Knowledge & Documents".
// GAP-KNOWLEDGE-DASHBOARD-01: removed fabricated "Storage" card. Replaced with document count.
// GAP-KNOWLEDGE-DASHBOARD-02: "Under Retention" now counts approved+under_review (labelled "Active"),
//   "Due for Archival" counts archived (labelled "Archived"); labels match computation.
// GAP-KNOWLEDGE-DASHBOARD-03: search chips link to /knowledge/search?q= and SearchClient reads it;
//   bulk upload button removed (no bulk flow exists — see DOCUMENTS-NEW-02).
export default async function KnowledgeDashboardPage() {
  const { data: docs, source } = await getKnowledgeDocs();
  const errored = source === "error";

  const total = docs.length;
  const circulars = errored ? 0 : docs.filter((d) => d.category?.toLowerCase().includes("circular")).length;
  // GAP-KNOWLEDGE-DASHBOARD-02: label matches computation
  const active = errored ? 0 : docs.filter((d) => d.status === "approved" || d.status === "under_review").length;
  const archived = errored ? 0 : docs.filter((d) => d.status === "archived").length;

  // GAP-KNOWLEDGE-DASHBOARD-07: these aggregates are computed from the documents
  // list, which the backend caps at its default page size (listQuerySchema
  // default limit = 50). There is no server-side aggregate endpoint yet, so when
  // the list is full we warn that the figures are based on the first N documents
  // rather than silently presenting a partial count as the whole repository.
  const DOCS_PAGE_LIMIT = 50;
  const capped = !errored && total >= DOCS_PAGE_LIMIT;

  const categoryMap = docs.reduce<Record<string, number>>((acc, d) => {
    acc[d.category] = (acc[d.category] ?? 0) + 1;
    return acc;
  }, {});
  const categoryList = Object.entries(categoryMap)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

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
        title="Knowledge &amp; Documents"
        subtitle="Digital repository, records retention &amp; enterprise search."
        actions={
          <Link href="/knowledge/documents/new" className="btn primary" style={{ minHeight: 44 }}>+ Add Document</Link>
        }
      />

      <StatGrid>
        <StatCard icon="📂" iconBg="#fef9e7" label="Documents" value={errored ? "—" : total.toLocaleString("en-IN")} />
        <StatCard icon="📜" iconBg="#eff6ff" label="Circulars/Policies" value={errored ? "—" : circulars.toLocaleString("en-IN")} />
        <StatCard icon="🗃️" iconBg="#ecfdf3" label="Active" value={errored ? "—" : active.toLocaleString("en-IN")} />
        <StatCard icon="📦" iconBg="#fffaeb" label="Archived" value={errored ? "—" : archived.toLocaleString("en-IN")} />
      </StatGrid>

      {/* GAP-KNOWLEDGE-DASHBOARD-07: honest note when the list is page-capped */}
      {capped && (
        <p role="note" style={{ margin: "8px 0 0", fontSize: 12, color: "var(--mut, #667085)" }}>
          Figures are based on the most recent {DOCS_PAGE_LIMIT} documents. A repository-wide summary is not yet available.
        </p>
      )}

      {errored ? (
        <RefreshErrorState error={toHumanError("load", { area: "knowledge dashboard" })} />
      ) : total === 0 ? (
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
              <RecentDocsTable rows={recentRows} />
            </div>

            <div className="card">
              <div className="card-h"><h3>Documents by category</h3></div>
              <div className="pad"><CategoryBarChart categories={categoryList} /></div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
            {/* GAP-KNOWLEDGE-DASHBOARD-01: removed fabricated Storage card.
                Replaced with a document count summary. */}
            <div className="card">
              <div className="card-h"><h3>Document totals</h3></div>
              <div className="pad" style={{ display: "grid", placeItems: "center", padding: "24px 16px" }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 36, fontWeight: 780, color: "var(--ink, #101828)" }}>
                    {total.toLocaleString("en-IN")}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--mut, #667085)", marginTop: 4 }}>
                    documents in repository
                  </div>
                </div>
              </div>
            </div>

            {/* GAP-KNOWLEDGE-DASHBOARD-03: quick search now links to /knowledge/search?q= */}
            <div className="card">
              <div className="card-h"><h3>Quick search</h3></div>
              <div className="pad">
                <Link
                  href="/knowledge/search"
                  className="tb-search"
                  style={{ maxWidth: "none", textDecoration: "none", display: "flex", alignItems: "center", gap: 8 }}
                >
                  <span aria-hidden="true">🔎</span>
                  <span style={{ color: "var(--mut)", fontSize: 14 }}>Search circulars, policies…</span>
                </Link>
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
