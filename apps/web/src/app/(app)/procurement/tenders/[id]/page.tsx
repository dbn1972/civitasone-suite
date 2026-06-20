import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getProcurementTenderById } from "../../../../_data/loaders";

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

export default async function Page({ params }: { params: { id: string } }) {
  const { data: tender, source } = await getProcurementTenderById(params.id);

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-5xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/procurement" className="hover:text-slate-900">Procurement</Link>
          <span className="mx-2">/</span>
          <Link href="/procurement/tenders" className="hover:text-slate-900">Tenders</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">{tender?.tenderNo ?? params.id}</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h1 className="text-3xl font-semibold text-slate-900">Tender Detail</h1>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        {tender ? (
          <div className="space-y-5">
            <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-lg font-semibold text-slate-900">{tender.tenderNo}</p>
                  <p className="mt-1 text-slate-700">{tender.title}</p>
                </div>
                <div className="flex gap-2">
                  <span className={`rounded-full px-3 py-1 text-xs font-medium ${typeColors[tender.type] ?? "bg-slate-100 text-slate-600"}`}>
                    {typeLabels[tender.type] ?? tender.type}
                  </span>
                  <span className={`rounded-full px-3 py-1 text-xs font-medium ${statusColors[tender.status] ?? "bg-slate-100 text-slate-600"}`}>
                    {tender.status}
                  </span>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 md:grid-cols-4">
                <div>
                  <p className="text-xs text-slate-500">Est. Value</p>
                  <p className="mt-1 font-semibold text-slate-900">₹{(tender.estimatedValue / 100).toLocaleString("en-IN")}</p>
                </div>
                {tender.publishDate && (
                  <div>
                    <p className="text-xs text-slate-500">Publish Date</p>
                    <p className="mt-1 text-sm text-slate-800">{tender.publishDate}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-slate-500">Bid Closing Date</p>
                  <p className="mt-1 text-sm text-slate-800">{tender.bidClosingDate}</p>
                </div>
                {tender.openingDate && (
                  <div>
                    <p className="text-xs text-slate-500">Opening Date</p>
                    <p className="mt-1 text-sm text-slate-800">{tender.openingDate}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-slate-500">Bids Received</p>
                  <p className="mt-1 text-sm font-medium text-slate-800">{tender.bidsReceived}</p>
                </div>
              </div>

              {tender.scope && (
                <div className="mt-4 border-t border-slate-100 pt-4">
                  <p className="text-xs text-slate-500">Scope</p>
                  <p className="mt-1 text-sm text-slate-700">{tender.scope}</p>
                </div>
              )}
              {tender.eligibilityCriteria && (
                <div className="mt-4">
                  <p className="text-xs text-slate-500">Eligibility Criteria</p>
                  <p className="mt-1 text-sm text-slate-700">{tender.eligibilityCriteria}</p>
                </div>
              )}
            </section>

            {tender.bids.length > 0 && (
              <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">Bids</div>
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-100 text-slate-700">
                    <tr>
                      <th className="px-4 py-3">Vendor Name</th>
                      <th className="px-4 py-3 text-right">Bid Amount (₹)</th>
                      <th className="px-4 py-3 text-right">Technical Score</th>
                      <th className="px-4 py-3 text-right">Financial Score</th>
                      <th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tender.bids.map((bid, i) => (
                      <tr key={i} className="border-t border-slate-200">
                        <td className="px-4 py-3 text-slate-800">{bid.vendorName}</td>
                        <td className="px-4 py-3 text-right font-medium text-slate-900">₹{(bid.bidAmount / 100).toLocaleString("en-IN")}</td>
                        <td className="px-4 py-3 text-right text-slate-600">{bid.technicalScore ?? "—"}</td>
                        <td className="px-4 py-3 text-right text-slate-600">{bid.financialScore ?? "—"}</td>
                        <td className="px-4 py-3">
                          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">{bid.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white py-12 text-center text-slate-400 shadow-sm">
            Tender not found
          </div>
        )}
      </section>
    </main>
  );
}
