import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageShell } from "../../../_components/PageShell";
import { getProcurementTenders } from "../../../_data/loaders";

const typeColors: Record<string, string> = {
  open: "bg-blue-50 text-blue-700",
  limited: "bg-purple-50 text-purple-700",
  single_source: "bg-orange-50 text-orange-700",
  gem: "bg-teal-50 text-teal-700",
};

const typeLabels: Record<string, string> = {
  open: "Open",
  limited: "Limited",
  single_source: "Single Source",
  gem: "GeM",
};

const statusColors: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  published: "bg-emerald-50 text-emerald-700",
  evaluation: "bg-amber-50 text-amber-700",
  awarded: "bg-blue-50 text-blue-700",
  cancelled: "bg-red-50 text-red-700",
};

export default async function Page() {
  const { data: tenders, source } = await getProcurementTenders();

  const total = tenders.length;
  const published = tenders.filter((t) => t.status === "published").length;
  const underEvaluation = tenders.filter((t) => t.status === "evaluation").length;
  const awarded = tenders.filter((t) => t.status === "awarded").length;

  return (
    <PageShell title="Tenders" description="Manage open, limited, and GeM tenders with bid tracking.">
      <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
        <Link href="/procurement" className="hover:text-slate-900">Procurement</Link>
        <span className="mx-2">/</span>
        <span className="text-slate-900">Tenders</span>
      </nav>

      {source === "error" ? <DataSourceBadge source={source} /> : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Total</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{total}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Published</p>
          <p className="mt-2 text-3xl font-bold text-emerald-600">{published}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Under Evaluation</p>
          <p className="mt-2 text-3xl font-bold text-amber-600">{underEvaluation}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Awarded</p>
          <p className="mt-2 text-3xl font-bold text-blue-600">{awarded}</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm" aria-label="Tenders list">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              <th scope="col" className="px-4 py-3 text-left">Tender No</th>
              <th scope="col" className="px-4 py-3 text-left">Title</th>
              <th scope="col" className="px-4 py-3 text-left">Type</th>
              <th scope="col" className="px-4 py-3 text-right">Est. Value (₹)</th>
              <th scope="col" className="px-4 py-3 text-left">Publish Date</th>
              <th scope="col" className="px-4 py-3 text-left">Bid Close Date</th>
              <th scope="col" className="px-4 py-3 text-right">Bids</th>
              <th scope="col" className="px-4 py-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {tenders.map((tender) => (
              <tr key={tender.id} className="border-t border-slate-200 hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link href={`/procurement/tenders/${tender.id}`} className="font-mono text-indigo-600 hover:underline">
                    {tender.tenderNo}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-800">{tender.title}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${typeColors[tender.type] ?? "bg-slate-100 text-slate-600"}`}>
                    {typeLabels[tender.type] ?? tender.type}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-medium text-slate-900">
                  ₹{(tender.estimatedValue / 100).toLocaleString("en-IN")}
                </td>
                <td className="px-4 py-3 text-slate-600">{tender.publishDate ?? "—"}</td>
                <td className="px-4 py-3 text-slate-600">{tender.bidClosingDate}</td>
                <td className="px-4 py-3 text-right text-slate-800">{tender.bidsReceived}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[tender.status] ?? "bg-slate-100 text-slate-600"}`}>
                    {tender.status}
                  </span>
                </td>
              </tr>
            ))}
            {tenders.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-400">No tenders found</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
