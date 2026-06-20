import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageShell } from "../../../_components/PageShell";
import { getRFQs } from "../../../_data/loaders";

const statusColors: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  issued: "bg-blue-50 text-blue-700",
  closed: "bg-slate-100 text-slate-500",
  cancelled: "bg-red-50 text-red-700",
  awarded: "bg-emerald-50 text-emerald-700",
};

export default async function Page() {
  const { data: rfqs, source } = await getRFQs();

  const total = rfqs.length;
  const issued = rfqs.filter((r) => r.status === "issued").length;
  const totalResponses = rfqs.reduce((sum, r) => sum + r.responsesReceived, 0);
  const awarded = rfqs.filter((r) => r.status === "awarded").length;

  return (
    <PageShell title="Request for Quotation" description="Manage RFQs issued to vendors and track responses received.">
      <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
        <Link href="/procurement" className="hover:text-slate-900">Procurement</Link>
        <span className="mx-2">/</span>
        <span className="text-slate-900">RFQ</span>
      </nav>

      {source === "error" ? <DataSourceBadge source={source} /> : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Total RFQs</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{total}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Issued</p>
          <p className="mt-2 text-3xl font-bold text-blue-600">{issued}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Responses Received</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{totalResponses}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Awarded</p>
          <p className="mt-2 text-3xl font-bold text-emerald-600">{awarded}</p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">All RFQs</h2>
        <Link
          href="/procurement/rfq/new"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          New RFQ
        </Link>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              <th className="px-4 py-3 text-left">RFQ No</th>
              <th className="px-4 py-3 text-left">Title</th>
              <th className="px-4 py-3 text-left">Indent Ref</th>
              <th className="px-4 py-3 text-right">Vendors Invited</th>
              <th className="px-4 py-3 text-right">Responses</th>
              <th className="px-4 py-3 text-left">Closing Date</th>
              <th className="px-4 py-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {rfqs.map((rfq) => (
              <tr key={rfq.id} className="border-t border-slate-200 hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link href={`/procurement/rfq/${rfq.id}`} className="font-mono text-indigo-600 hover:underline">
                    {rfq.rfqNo}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-800">{rfq.title}</td>
                <td className="px-4 py-3 font-mono text-slate-500">{rfq.indentRef ?? "—"}</td>
                <td className="px-4 py-3 text-right text-slate-800">{rfq.vendorsInvited}</td>
                <td className="px-4 py-3 text-right text-slate-800">{rfq.responsesReceived}</td>
                <td className="px-4 py-3 text-slate-600">{rfq.closingDate}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[rfq.status] ?? "bg-slate-100 text-slate-600"}`}>
                    {rfq.status}
                  </span>
                </td>
              </tr>
            ))}
            {rfqs.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">No RFQs found</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
