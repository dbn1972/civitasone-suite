import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageShell } from "../../../_components/PageShell";
import { getProcurementIndents } from "../../../_data/loaders";

const statusColors: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  pending_approval: "bg-amber-50 text-amber-700",
  approved: "bg-emerald-50 text-emerald-700",
  rejected: "bg-red-50 text-red-700",
  converted_to_po: "bg-blue-50 text-blue-700",
};

const statusLabels: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Pending Approval",
  approved: "Approved",
  rejected: "Rejected",
  converted_to_po: "Converted to PO",
};

export default async function Page() {
  const { data: indents, source } = await getProcurementIndents();

  const total = indents.length;
  const pendingApproval = indents.filter((i) => i.status === "pending_approval").length;
  const approved = indents.filter((i) => i.status === "approved").length;
  const converted = indents.filter((i) => i.status === "converted_to_po").length;

  return (
    <PageShell title="Purchase Indents" description="Track material requisitions from departments through to PO conversion.">
      <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
        <Link href="/procurement" className="hover:text-slate-900">Procurement</Link>
        <span className="mx-2">/</span>
        <span className="text-slate-900">Indents</span>
      </nav>

      {source === "error" ? <DataSourceBadge source={source} /> : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Total</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{total}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Pending Approval</p>
          <p className="mt-2 text-3xl font-bold text-amber-600">{pendingApproval}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Approved</p>
          <p className="mt-2 text-3xl font-bold text-emerald-600">{approved}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Converted</p>
          <p className="mt-2 text-3xl font-bold text-blue-600">{converted}</p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">All Indents</h2>
        <Link
          href="/procurement/indents/new"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          New Indent
        </Link>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              <th className="px-4 py-3 text-left">Indent No</th>
              <th className="px-4 py-3 text-left">Requested By</th>
              <th className="px-4 py-3 text-left">Department</th>
              <th className="px-4 py-3 text-right">Items</th>
              <th className="px-4 py-3 text-right">Est. Amount (₹)</th>
              <th className="px-4 py-3 text-left">Request Date</th>
              <th className="px-4 py-3 text-left">Required By</th>
              <th className="px-4 py-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {indents.map((indent) => (
              <tr key={indent.id} className="border-t border-slate-200 hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link href={`/procurement/indents/${indent.id}`} className="font-mono text-indigo-600 hover:underline">
                    {indent.indentNo}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-800">{indent.requestedBy}</td>
                <td className="px-4 py-3 text-slate-600">{indent.department}</td>
                <td className="px-4 py-3 text-right text-slate-800">{indent.itemCount}</td>
                <td className="px-4 py-3 text-right font-medium text-slate-900">
                  ₹{(indent.estimatedAmount / 100).toLocaleString("en-IN")}
                </td>
                <td className="px-4 py-3 text-slate-600">{indent.requestDate}</td>
                <td className="px-4 py-3 text-slate-600">{indent.requiredByDate ?? "—"}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[indent.status] ?? "bg-slate-100 text-slate-600"}`}>
                    {statusLabels[indent.status] ?? indent.status}
                  </span>
                </td>
              </tr>
            ))}
            {indents.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-400">No indents found</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
