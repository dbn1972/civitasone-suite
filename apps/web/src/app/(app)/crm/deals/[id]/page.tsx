import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getDealById } from "../../../../_data/loaders";

const stageColors: Record<string, string> = {
  prospecting: "bg-slate-100 text-slate-600",
  qualification: "bg-blue-50 text-blue-700",
  proposal: "bg-amber-50 text-amber-700",
  negotiation: "bg-orange-50 text-orange-700",
  closed_won: "bg-emerald-50 text-emerald-700",
  closed_lost: "bg-red-50 text-red-700",
};

const statusColors: Record<string, string> = {
  open: "bg-blue-50 text-blue-700",
  won: "bg-emerald-50 text-emerald-700",
  lost: "bg-red-50 text-red-700",
};

function pill(label: string, colors: Record<string, string>, key: string) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${colors[key] ?? "bg-slate-100 text-slate-600"}`}>
      {label.replace(/_/g, " ")}
    </span>
  );
}

export default async function Page({ params }: { params: { id: string } }) {
  const { data: deal, source } = await getDealById(params.id);

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-4xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/crm" className="hover:text-slate-900">CRM</Link>
          <span className="mx-2">/</span>
          <Link href="/crm/deals" className="hover:text-slate-900">Deals</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">{deal?.dealName ?? params.id}</span>
        </nav>

        <header className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold text-slate-900">Deal Detail</h1>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        {deal ? (
          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">{deal.dealName}</h2>
                {deal.contactName && (
                  <p className="mt-1 text-sm text-slate-600">Contact: {deal.contactName}</p>
                )}
              </div>
              <div className="flex gap-2">
                {pill(deal.stage, stageColors, deal.stage)}
                {pill(deal.status, statusColors, deal.status)}
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-4 border-t border-slate-100 pt-5 md:grid-cols-3">
              <div>
                <p className="text-xs text-slate-500">Amount</p>
                <p className="mt-1 font-semibold text-slate-900">
                  ₹{(deal.amount / 100).toLocaleString("en-IN")}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Probability</p>
                <p className="mt-1 text-slate-800">{deal.probability}%</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Owner</p>
                <p className="mt-1 text-slate-800">{deal.owner}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Close Date</p>
                <p className="mt-1 text-slate-800">{deal.closeDate ?? "—"}</p>
              </div>
            </div>
          </section>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white py-12 text-center text-slate-400 shadow-sm">
            Deal not found
          </div>
        )}
      </section>
    </main>
  );
}
