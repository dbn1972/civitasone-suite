import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageShell } from "../../../_components/PageShell";
import { getDeals } from "../../../_data/loaders";
import type { DealSummary } from "@civitasone/types";

const stageColors: Record<DealSummary["stage"], string> = {
  prospecting: "bg-slate-100 text-slate-600",
  qualification: "bg-blue-50 text-blue-700",
  proposal: "bg-amber-50 text-amber-700",
  negotiation: "bg-orange-50 text-orange-700",
  closed_won: "bg-emerald-50 text-emerald-700",
  closed_lost: "bg-red-50 text-red-700",
};

const statusColors: Record<DealSummary["status"], string> = {
  open: "bg-blue-50 text-blue-700",
  won: "bg-emerald-50 text-emerald-700",
  lost: "bg-red-50 text-red-700",
};

function pill(label: string, colorClass: string) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${colorClass}`}>
      {label.replace(/_/g, " ")}
    </span>
  );
}

function fmtAmount(paise: number): string {
  const val = paise / 100;
  return `₹${val.toLocaleString("en-IN")}`;
}

export default async function Page() {
  const { data: deals, source } = await getDeals();

  const totalDeals = deals.length;
  const openDeals = deals.filter((d) => d.status === "open").length;
  const pipelineValue = deals.filter((d) => d.status === "open").reduce((s, d) => s + d.amount, 0);
  const wonValue = deals.filter((d) => d.status === "won").reduce((s, d) => s + d.amount, 0);

  const stats = [
    { label: "Total Deals", value: totalDeals.toLocaleString("en-IN") },
    { label: "Open", value: openDeals.toLocaleString("en-IN") },
    { label: "Pipeline Value", value: fmtAmount(pipelineValue) },
    { label: "Won Value", value: fmtAmount(wonValue) },
  ];

  return (
    <PageShell title="Deal Pipeline" description="Track high-value opportunities across stages.">
      {source === "error" ? <DataSourceBadge source={source} /> : null}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs text-slate-500">{s.label}</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="tbl min-w-full text-sm">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              <th className="px-4 py-3 text-left">Deal Name</th>
              <th className="px-4 py-3 text-left">Contact</th>
              <th className="px-4 py-3 text-left">Stage</th>
              <th className="px-4 py-3 text-right">Amount (₹)</th>
              <th className="px-4 py-3 text-right">Prob %</th>
              <th className="px-4 py-3 text-left">Owner</th>
              <th className="px-4 py-3 text-left">Close Date</th>
              <th className="px-4 py-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {deals.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-400">No deals found</td>
              </tr>
            ) : (
              deals.map((deal) => (
                <tr key={deal.id} className="border-t border-slate-200 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    <Link href={`/crm/deals/${deal.id}`} className="hover:text-indigo-600 hover:underline">
                      {deal.dealName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{deal.contactName ?? "—"}</td>
                  <td className="px-4 py-3">{pill(deal.stage, stageColors[deal.stage])}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-800">{fmtAmount(deal.amount)}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{deal.probability}%</td>
                  <td className="px-4 py-3 text-slate-600">{deal.owner}</td>
                  <td className="px-4 py-3 text-slate-500">{deal.closeDate ?? "—"}</td>
                  <td className="px-4 py-3">{pill(deal.status, statusColors[deal.status])}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
