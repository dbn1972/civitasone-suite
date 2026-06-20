import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageShell } from "../../../_components/PageShell";
import { getProcurementGRNs } from "../../../_data/loaders";

const statusColors: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  received: "bg-blue-50 text-blue-700",
  quality_check: "bg-amber-50 text-amber-700",
  accepted: "bg-emerald-50 text-emerald-700",
  partially_rejected: "bg-orange-50 text-orange-700",
  rejected: "bg-red-50 text-red-700",
};

const statusLabels: Record<string, string> = {
  draft: "Draft",
  received: "Received",
  quality_check: "Quality Check",
  accepted: "Accepted",
  partially_rejected: "Partially Rejected",
  rejected: "Rejected",
};

export default async function Page() {
  const { data: grns, source } = await getProcurementGRNs();

  const total = grns.length;
  const accepted = grns.filter((g) => g.status === "accepted").length;
  const pendingQC = grns.filter((g) => g.status === "quality_check" || g.status === "received").length;
  const rejected = grns.filter((g) => g.status === "rejected" || g.status === "partially_rejected").length;

  return (
    <PageShell title="Goods Receipt Notes" description="Record and track goods received against purchase orders.">
      <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
        <Link href="/procurement" className="hover:text-slate-900">Procurement</Link>
        <span className="mx-2">/</span>
        <span className="text-slate-900">GRN</span>
      </nav>

      {source === "error" ? <DataSourceBadge source={source} /> : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Total GRNs</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{total}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Accepted</p>
          <p className="mt-2 text-3xl font-bold text-emerald-600">{accepted}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Pending QC</p>
          <p className="mt-2 text-3xl font-bold text-amber-600">{pendingQC}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Rejected</p>
          <p className="mt-2 text-3xl font-bold text-red-600">{rejected}</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              <th className="px-4 py-3 text-left">GRN No</th>
              <th className="px-4 py-3 text-left">PO Ref</th>
              <th className="px-4 py-3 text-left">Vendor</th>
              <th className="px-4 py-3 text-left">Received Date</th>
              <th className="px-4 py-3 text-left">Received By</th>
              <th className="px-4 py-3 text-right">Items</th>
              <th className="px-4 py-3 text-right">Total Value (₹)</th>
              <th className="px-4 py-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {grns.map((grn) => (
              <tr key={grn.id} className="border-t border-slate-200 hover:bg-slate-50">
                <td className="px-4 py-3 font-mono text-slate-800">{grn.grnNo}</td>
                <td className="px-4 py-3 font-mono text-indigo-600">{grn.poRef}</td>
                <td className="px-4 py-3 text-slate-800">{grn.vendor}</td>
                <td className="px-4 py-3 text-slate-600">{grn.receivedDate}</td>
                <td className="px-4 py-3 text-slate-600">{grn.receivedBy}</td>
                <td className="px-4 py-3 text-right text-slate-800">{grn.itemCount}</td>
                <td className="px-4 py-3 text-right font-medium text-slate-900">
                  ₹{(grn.totalValue / 100).toLocaleString("en-IN")}
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[grn.status] ?? "bg-slate-100 text-slate-600"}`}>
                    {statusLabels[grn.status] ?? grn.status}
                  </span>
                </td>
              </tr>
            ))}
            {grns.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-400">No GRNs found</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
