import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getMeetings } from "../../../_data/loaders";
import type { MeetingSummary } from "@civitasone/types";

const typeColors: Record<MeetingSummary["type"], string> = {
  cabinet: "bg-red-50 text-red-700",
  committee: "bg-blue-50 text-blue-700",
  department: "bg-emerald-50 text-emerald-700",
  review: "bg-amber-50 text-amber-700",
  external: "bg-slate-100 text-slate-600",
};

const statusColors: Record<MeetingSummary["status"], string> = {
  scheduled: "bg-blue-50 text-blue-700",
  in_progress: "bg-emerald-50 text-emerald-700",
  completed: "bg-slate-100 text-slate-600",
  cancelled: "bg-red-50 text-red-700",
  postponed: "bg-amber-50 text-amber-700",
};

export default async function MeetingsPage() {
  const { data: meetings, source } = await getMeetings();
  const today = new Date().toISOString().split("T")[0];
  const total = meetings.length;
  const scheduled = meetings.filter((m) => m.status === "scheduled" && m.scheduledDate >= today).length;
  const completed = meetings.filter((m) => m.status === "completed").length;
  const cancelled = meetings.filter((m) => m.status === "cancelled").length;

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/estab" className="hover:text-slate-900">Establishment</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Meetings</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Meeting Management</h1>
            <p className="mt-1 text-sm text-slate-600">Schedule meetings, prepare agenda, capture MOM &amp; track actions.</p>
          </div>
          <div className="flex items-center gap-2">
            {source === "error" ? <DataSourceBadge source={source} /> : null}
            <button className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">
              + Schedule
            </button>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[
            { label: "Total", value: total, color: "text-slate-900" },
            { label: "Upcoming / Scheduled", value: scheduled, color: "text-blue-600" },
            { label: "Completed", value: completed, color: "text-slate-500" },
            { label: "Cancelled", value: cancelled, color: "text-red-600" },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-sm text-slate-500">{s.label}</p>
              <p className={`mt-1 text-2xl font-bold ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table aria-label="Meetings list" className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th scope="col" className="px-4 py-3">Meeting No</th>
                <th scope="col" className="px-4 py-3">Title</th>
                <th scope="col" className="px-4 py-3">Type</th>
                <th scope="col" className="px-4 py-3">Date</th>
                <th scope="col" className="px-4 py-3">Time</th>
                <th scope="col" className="px-4 py-3">Venue</th>
                <th scope="col" className="px-4 py-3">Chairperson</th>
                <th scope="col" className="px-4 py-3 text-right">Attendees</th>
                <th scope="col" className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {meetings.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-400">No meetings found</td>
                </tr>
              ) : (
                meetings.map((m) => (
                  <tr key={m.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link href={`/estab/meetings/${m.id}`} className="font-mono text-indigo-600 hover:underline">
                        {m.meetingNo}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-800">{m.title}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${typeColors[m.type]}`}>
                        {m.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{m.scheduledDate}</td>
                    <td className="px-4 py-3 text-slate-600">{m.scheduledTime ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{m.venue ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{m.chairperson ?? "—"}</td>
                    <td className="px-4 py-3 text-right text-slate-800">{m.attendeesCount}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[m.status]}`}>
                        {m.status.replace("_", " ")}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </section>
    </main>
  );
}
