import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getKnowledgeDocs } from "../../../_data/loaders";

const BAR_W = 640;
const BAR_H = 150;
const BAR_PAD = 10;
const BAR_GAP = 6;
const LABEL_H = 16;

function CategoryBarChart({
  categories,
}: {
  categories: { name: string; count: number }[];
}) {
  const items = categories.slice(0, 7);
  if (items.length === 0) return null;

  const maxVal = Math.max(...items.map((c) => c.count), 1);
  const n = items.length;
  const barW = Math.floor((BAR_W - BAR_PAD * 2 - BAR_GAP * (n - 1)) / n);
  const chartH = BAR_H - LABEL_H;

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${BAR_W} ${BAR_H}`}
      aria-label="Documents by category bar chart"
      role="img"
    >
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
    <svg
      width={132}
      height={132}
      viewBox="0 0 132 132"
      aria-label={`Storage usage: ${usedPct.toFixed(0)}% of quota`}
      role="img"
    >
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#eef0f4" strokeWidth={13} />
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="#ca8a04"
        strokeWidth={13}
        strokeDasharray={circ}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}
      />
      <text x="50%" y="46%" textAnchor="middle" dy=".1em" fontSize={22} fontWeight={780} fill="#101828">
        {usedPct.toFixed(0)}%
      </text>
      <text x="50%" y="63%" textAnchor="middle" fontSize={9.5} fill="#98a2b3">
        of quota
      </text>
    </svg>
  );
}

const statusColors: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  under_review: "bg-amber-50 text-amber-700",
  approved: "bg-emerald-50 text-emerald-700",
  archived: "bg-slate-100 text-slate-500",
};

export default async function KnowledgeDashboardPage() {
  const { data: docs, source } = await getKnowledgeDocs();

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const total = docs.length;
  const recent = docs.filter((d) => new Date(d.createdAt) >= thirtyDaysAgo).length;
  const pendingApproval = docs.filter((d) => d.status === "under_review").length;
  const categories = [...new Set(docs.map((d) => d.category))].length;

  const categoryMap = docs.reduce<Record<string, number>>((acc, d) => {
    acc[d.category] = (acc[d.category] ?? 0) + 1;
    return acc;
  }, {});
  const categoryList = Object.entries(categoryMap)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const storagePct = total > 0 ? Math.min(100, Math.round((total / 500) * 100)) : 0;

  const recentDocs = [...docs]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/knowledge" className="hover:text-slate-900">Knowledge</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Dashboard</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Knowledge &amp; Document Management</h1>
            <p className="mt-1 text-sm text-slate-600">Digital repository, records retention &amp; enterprise search.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section aria-label="Document statistics" className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Documents</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{total.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Recent (30d)</p>
            <p className="mt-1 text-2xl font-bold text-blue-600">{recent.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Pending Approval</p>
            <p className="mt-1 text-2xl font-bold text-amber-600">{pendingApproval.toLocaleString("en-IN")}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Categories</p>
            <p className="mt-1 text-2xl font-bold text-purple-600">{categories.toLocaleString("en-IN")}</p>
          </div>
        </section>

        {total === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center shadow-sm">
            <p className="text-slate-400">No documents in the repository yet.</p>
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-3">
            <div className="space-y-5 lg:col-span-2">
              <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-5 py-3 flex items-center justify-between">
                  <h2 className="text-base font-semibold text-slate-800">Recent publications</h2>
                  <Link href="/knowledge/repository" className="text-xs text-blue-600 hover:underline">
                    Repository →
                  </Link>
                </div>
                <div className="overflow-x-auto">
                  <table aria-label="Recent documents" className="min-w-full text-left text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th scope="col" className="px-4 py-3">Document</th>
                        <th scope="col" className="px-4 py-3">Category</th>
                        <th scope="col" className="px-4 py-3">Author</th>
                        <th scope="col" className="px-4 py-3">Date</th>
                        <th scope="col" className="px-4 py-3">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentDocs.map((doc) => (
                        <tr key={doc.id} className="border-t border-slate-100 hover:bg-slate-50">
                          <td className="px-4 py-3 font-medium text-slate-900 max-w-xs truncate" title={doc.title}>
                            {doc.title}
                          </td>
                          <td className="px-4 py-3 text-slate-600">{doc.category}</td>
                          <td className="px-4 py-3 text-slate-600">{doc.author ?? "—"}</td>
                          <td className="px-4 py-3 text-slate-500 whitespace-nowrap text-xs">{doc.createdAt}</td>
                          <td className="px-4 py-3">
                            <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[doc.status] ?? "bg-slate-100 text-slate-600"}`}>
                              {doc.status.replace("_", " ")}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="mb-3 text-base font-semibold text-slate-800">Documents by category</h2>
                <CategoryBarChart categories={categoryList} />
              </section>
            </div>

            <div className="space-y-5">
              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="mb-3 text-base font-semibold text-slate-800">Storage</h2>
                <div className="flex justify-center">
                  <StorageDonut usedPct={storagePct} />
                </div>
              </section>

              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="mb-3 text-base font-semibold text-slate-800">Quick search</h2>
                <div className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-400">
                  🔎{" "}
                  <Link href="/knowledge/search" className="hover:text-slate-700">
                    Search circulars, policies, records…
                  </Link>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {["travel policy", "GFR 2017", "recruitment"].map((term) => (
                    <Link
                      key={term}
                      href={`/knowledge/search?q=${encodeURIComponent(term)}`}
                      className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600 hover:bg-slate-200"
                    >
                      {term}
                    </Link>
                  ))}
                </div>
              </section>

              <section className="grid grid-cols-1 gap-2">
                {[
                  { label: "Repository", href: "/knowledge/repository" },
                  { label: "Records Management", href: "/knowledge/records" },
                  { label: "Enterprise Search", href: "/knowledge/search" },
                ].map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md text-sm font-medium text-slate-800"
                  >
                    {link.label} →
                  </Link>
                ))}
              </section>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
