import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageShell } from "../../../_components/PageShell";
import { getCRMActivities } from "../../../_data/loaders";
import type { CRMActivityEntry } from "@civitasone/types";

const typeColors: Record<CRMActivityEntry["type"], string> = {
  call: "bg-blue-50 text-blue-700",
  meeting: "bg-purple-50 text-purple-700",
  email: "bg-slate-100 text-slate-600",
  task: "bg-amber-50 text-amber-700",
  note: "bg-emerald-50 text-emerald-700",
};

const statusColors: Record<CRMActivityEntry["status"], string> = {
  open: "bg-blue-50 text-blue-700",
  overdue: "bg-red-50 text-red-700",
  completed: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-slate-100 text-slate-500",
};

function pill(label: string, colorClass: string) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${colorClass}`}>
      {label}
    </span>
  );
}

export default async function Page() {
  const { data: activities, source } = await getCRMActivities();

  const total = activities.length;
  const dueToday = activities.filter((a) => a.dueDate === new Date().toISOString().slice(0, 10)).length;
  const overdue = activities.filter((a) => a.status === "overdue").length;
  const completed = activities.filter((a) => a.status === "completed").length;

  const stats = [
    { label: "Total", value: total.toLocaleString("en-IN") },
    { label: "Due Today", value: dueToday.toLocaleString("en-IN") },
    { label: "Overdue", value: overdue.toLocaleString("en-IN") },
    { label: "Completed", value: completed.toLocaleString("en-IN") },
  ];

  return (
    <PageShell title="CRM Activities" description="Calls, meetings, emails, tasks and notes.">
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
              <th className="px-4 py-3 text-left">Type</th>
              <th className="px-4 py-3 text-left">Subject</th>
              <th className="px-4 py-3 text-left">Related To</th>
              <th className="px-4 py-3 text-left">Due Date</th>
              <th className="px-4 py-3 text-left">Completed At</th>
              <th className="px-4 py-3 text-left">Owner</th>
              <th className="px-4 py-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {activities.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">No activities</td>
              </tr>
            ) : (
              activities.map((a) => (
                <tr key={a.id} className="border-t border-slate-200 hover:bg-slate-50">
                  <td className="px-4 py-3">{pill(a.type, typeColors[a.type])}</td>
                  <td className="px-4 py-3 text-slate-800">{a.subject}</td>
                  <td className="px-4 py-3 text-slate-500">{a.relatedTo ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-500">{a.dueDate ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-500">{a.completedAt ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-700">{a.owner}</td>
                  <td className="px-4 py-3">{pill(a.status, statusColors[a.status])}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
