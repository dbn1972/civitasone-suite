import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageShell } from "../../../_components/PageShell";
import { getCitizenRequests } from "../../../_data/loaders";
import type { CitizenRequestSummary } from "@civitasone/types";

const statusColors: Record<CitizenRequestSummary["status"], string> = {
  submitted: "bg-blue-50 text-blue-700",
  under_review: "bg-amber-50 text-amber-700",
  in_progress: "bg-orange-50 text-orange-700",
  resolved: "bg-emerald-50 text-emerald-700",
  rejected: "bg-red-50 text-red-700",
};

function pill(label: string, colorClass: string) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${colorClass}`}>
      {label.replace(/_/g, " ")}
    </span>
  );
}

export default async function Page() {
  const { data: requests, source } = await getCitizenRequests();

  const total = requests.length;
  const underReview = requests.filter((r) => r.status === "under_review" || r.status === "in_progress").length;
  const resolved = requests.filter((r) => r.status === "resolved").length;
  const rejected = requests.filter((r) => r.status === "rejected").length;

  const stats = [
    { label: "Total Requests", value: total.toLocaleString("en-IN") },
    { label: "Under Review", value: underReview.toLocaleString("en-IN") },
    { label: "Resolved", value: resolved.toLocaleString("en-IN") },
    { label: "Rejected", value: rejected.toLocaleString("en-IN") },
  ];

  return (
    <PageShell
      title="Citizen Service Requests"
      description="Grievances and service requests with SLA and routing."
      breadcrumb={
        <>
          <Link href="/citizen" className="hover:text-slate-900">Citizen</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Requests</span>
        </>
      }
    >
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
        <table className="min-w-full text-sm" aria-label="Citizen service requests">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              <th scope="col" className="px-4 py-3 text-left">Request No</th>
              <th scope="col" className="px-4 py-3 text-left">Service Type</th>
              <th scope="col" className="px-4 py-3 text-left">Citizen Name</th>
              <th scope="col" className="px-4 py-3 text-left">Phone</th>
              <th scope="col" className="px-4 py-3 text-left">Submitted</th>
              <th scope="col" className="px-4 py-3 text-left">Expected Resolution</th>
              <th scope="col" className="px-4 py-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {requests.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center">
                  <p className="text-slate-500 font-medium">No service requests</p>
                  <p className="mt-1 text-sm text-slate-400">Citizen requests will appear here once submitted.</p>
                </td>
              </tr>
            ) : (
              requests.map((r) => (
                <tr key={r.id} className="border-t border-slate-200 hover:bg-slate-50 focus-within:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-slate-700">{r.requestNo}</td>
                  <td className="px-4 py-3 text-slate-800">{r.serviceType}</td>
                  <td className="px-4 py-3 text-slate-800">{r.citizenName}</td>
                  <td className="px-4 py-3 text-slate-500">{r.citizenPhone ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-500">{r.submittedAt.slice(0, 10)}</td>
                  <td className="px-4 py-3 text-slate-500">{r.expectedResolutionDate ?? "—"}</td>
                  <td className="px-4 py-3">{pill(r.status, statusColors[r.status])}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
