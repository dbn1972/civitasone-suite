import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getMeetingById } from "../../../../_data/loaders";

const statusColors: Record<string, string> = {
  scheduled: "bg-blue-50 text-blue-700",
  in_progress: "bg-emerald-50 text-emerald-700",
  completed: "bg-slate-100 text-slate-600",
  cancelled: "bg-red-50 text-red-700",
  postponed: "bg-amber-50 text-amber-700",
};

const actionStatusColors: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700",
  completed: "bg-emerald-50 text-emerald-700",
};

export default async function MeetingDetailPage({ params }: { params: { id: string } }) {
  const { data: meeting, source } = await getMeetingById(params.id);

  if (!meeting) {
    return (
      <main className="min-h-screen bg-slate-50 p-6 md:p-8">
        <section className="mx-auto max-w-5xl space-y-5">
          <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
            <Link href="/estab" className="hover:text-slate-900">Establishment</Link>
            <span className="mx-2">/</span>
            <Link href="/estab/meetings" className="hover:text-slate-900">Meetings</Link>
            <span className="mx-2">/</span>
            <span className="text-slate-900">Not Found</span>
          </nav>
          <p className="text-slate-500">Meeting not found.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-5xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/estab" className="hover:text-slate-900">Establishment</Link>
          <span className="mx-2">/</span>
          <Link href="/estab/meetings" className="hover:text-slate-900">Meetings</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">{meeting.meetingNo}</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-slate-500">{meeting.meetingNo}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[meeting.status] ?? "bg-slate-100 text-slate-600"}`}>
                {meeting.status.replace(/_/g, " ")}
              </span>
            </div>
            <h1 className="mt-1 text-2xl font-semibold text-slate-900">{meeting.title}</h1>
            <div className="mt-1 flex flex-wrap gap-4 text-sm text-slate-600">
              <span>{meeting.scheduledDate}{meeting.scheduledTime ? ` · ${meeting.scheduledTime}` : ""}</span>
              {meeting.venue && <span>Venue: {meeting.venue}</span>}
              {meeting.chairperson && <span>Chairperson: {meeting.chairperson}</span>}
            </div>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        {meeting.attendees.length > 0 && (
          <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">Attendees</div>
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Designation</th>
                  <th className="px-4 py-3">Present</th>
                </tr>
              </thead>
              <tbody>
                {meeting.attendees.map((a, i) => (
                  <tr key={i} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-800">{a.name}</td>
                    <td className="px-4 py-3 text-slate-600">{a.designation ?? "—"}</td>
                    <td className="px-4 py-3">
                      {a.present
                        ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Yes</span>
                        : <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">No</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {meeting.agenda.length > 0 && (
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-base font-semibold text-slate-900">Agenda</h2>
            <ol className="space-y-4">
              {meeting.agenda.map((item) => (
                <li key={item.id} className="flex gap-3">
                  <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700">
                    {item.itemNo}
                  </span>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-slate-900">{item.title}</p>
                    {item.description && <p className="mt-0.5 text-xs text-slate-500">{item.description}</p>}
                    {item.decision && (
                      <p className="mt-1 rounded bg-slate-50 px-2 py-1 text-xs text-slate-700">
                        <span className="font-semibold">Decision:</span> {item.decision}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        {meeting.minutes && (
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-base font-semibold text-slate-900">Minutes</h2>
            <pre className="whitespace-pre-wrap font-sans text-sm text-slate-700">{meeting.minutes}</pre>
          </section>
        )}

        {meeting.actionPoints.length > 0 && (
          <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800">Action Points</div>
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3">Assigned To</th>
                  <th className="px-4 py-3">Due Date</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {meeting.actionPoints.map((ap) => (
                  <tr key={ap.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-800">{ap.description}</td>
                    <td className="px-4 py-3 text-slate-600">{ap.assignedTo}</td>
                    <td className="px-4 py-3 text-slate-600">{ap.dueDate ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${actionStatusColors[ap.status] ?? "bg-slate-100 text-slate-600"}`}>
                        {ap.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </section>
    </main>
  );
}
