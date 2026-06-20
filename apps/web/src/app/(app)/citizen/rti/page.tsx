import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageShell } from "../../../_components/PageShell";
import { getRTIApplications } from "../../../_data/loaders";
import type { RTISummary } from "@civitasone/types";

const statusColors: Record<RTISummary["status"], string> = {
  received: "bg-blue-50 text-blue-700",
  forwarded: "bg-amber-50 text-amber-700",
  under_review: "bg-orange-50 text-orange-700",
  replied: "bg-emerald-50 text-emerald-700",
  appeal: "bg-red-50 text-red-700",
  closed: "bg-slate-100 text-slate-500",
};

const TODAY = new Date().toISOString().slice(0, 10);

function pill(label: string, colorClass: string) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${colorClass}`}>
      {label.replace(/_/g, " ")}
    </span>
  );
}

export default async function Page() {
  const { data: rtis, source } = await getRTIApplications();

  const total = rtis.length;
  const pendingReply = rtis.filter((r) => r.status === "received" || r.status === "under_review" || r.status === "forwarded").length;
  const overdue = rtis.filter((r) => r.deadlineDate != null && r.deadlineDate < TODAY && r.status !== "replied" && r.status !== "closed").length;
  const replied = rtis.filter((r) => r.status === "replied").length;

  const stats = [
    { label: "Total RTI", value: total.toLocaleString("en-IN") },
    { label: "Pending Reply", value: pendingReply.toLocaleString("en-IN") },
    { label: "Overdue", value: overdue.toLocaleString("en-IN") },
    { label: "Replied", value: replied.toLocaleString("en-IN") },
  ];

  return (
    <PageShell title="RTI Applications" description="Right to Information filings tracked under RTI Act 2005.">
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
              <th className="px-4 py-3 text-left">RTI No</th>
              <th className="px-4 py-3 text-left">Applicant</th>
              <th className="px-4 py-3 text-left">Subject</th>
              <th className="px-4 py-3 text-left">Public Authority</th>
              <th className="px-4 py-3 text-left">Filed</th>
              <th className="px-4 py-3 text-left">Deadline</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">1st Appeal?</th>
            </tr>
          </thead>
          <tbody>
            {rtis.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-400">No RTI applications</td>
              </tr>
            ) : (
              rtis.map((r) => {
                const isOverdue = r.deadlineDate != null && r.deadlineDate < TODAY && r.status !== "replied" && r.status !== "closed";
                return (
                  <tr key={r.id} className={`border-t border-slate-200 hover:bg-slate-50 ${isOverdue ? "bg-red-50/40" : ""}`}>
                    <td className="px-4 py-3 font-mono text-slate-700">{r.rtiNo}</td>
                    <td className="px-4 py-3 text-slate-800">{r.applicantName}</td>
                    <td className="px-4 py-3 text-slate-800 max-w-xs truncate">{r.subject}</td>
                    <td className="px-4 py-3 text-slate-500">{r.publicAuthority ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-500">{r.filedDate.slice(0, 10)}</td>
                    <td className="px-4 py-3">
                      {r.deadlineDate ? (
                        <span className={isOverdue ? "font-medium text-red-600" : "text-slate-500"}>
                          {r.deadlineDate.slice(0, 10)}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3">{pill(r.status, statusColors[r.status])}</td>
                    <td className="px-4 py-3 text-center text-slate-500">{r.isFirstAppeal ? "Yes" : "No"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
