import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageShell } from "../../../_components/PageShell";
import { getBreachedSLATickets } from "../../../_data/loaders";

export default async function Page() {
  const { data: tickets, source } = await getBreachedSLATickets();

  const breached = tickets.filter((t) => t.slaStatus === "breached");

  const sorted = [...breached].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  const priorityColors: Record<string, string> = {
    low: "bg-slate-100 text-slate-600",
    medium: "bg-blue-50 text-blue-700",
    high: "bg-orange-50 text-orange-700",
    critical: "bg-red-50 text-red-700",
  };

  const statusColors: Record<string, string> = {
    open: "bg-blue-50 text-blue-700",
    in_progress: "bg-amber-50 text-amber-700",
    pending: "bg-orange-50 text-orange-700",
    resolved: "bg-emerald-50 text-emerald-700",
    closed: "bg-slate-100 text-slate-500",
  };

  function pill(label: string, colors: Record<string, string>, key: string) {
    return (
      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${colors[key] ?? "bg-slate-100 text-slate-600"}`}>
        {label.replace(/_/g, " ")}
      </span>
    );
  }

  return (
    <PageShell
      title="SLA Queue — Breached Tickets"
      description="Tickets where SLA has been breached, sorted oldest first."
      breadcrumb={
        <>
          <Link href="/helpdesk" className="hover:text-slate-900">Helpdesk</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">SLA Queue</span>
        </>
      }
    >
      {source === "error" ? <DataSourceBadge source={source} /> : null}

      <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
        {sorted.length} breached {sorted.length === 1 ? "ticket" : "tickets"} require immediate attention.
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm" aria-label="SLA breached tickets">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              <th scope="col" className="px-4 py-3 text-left">Ticket No</th>
              <th scope="col" className="px-4 py-3 text-left">Subject</th>
              <th scope="col" className="px-4 py-3 text-left">Requester</th>
              <th scope="col" className="px-4 py-3 text-left">Priority</th>
              <th scope="col" className="px-4 py-3 text-left">Status</th>
              <th scope="col" className="px-4 py-3 text-left">Created</th>
              <th scope="col" className="px-4 py-3 text-left">Assigned To</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center">
                  <p className="text-emerald-600 font-medium">All clear — no SLA breaches</p>
                  <p className="mt-1 text-sm text-slate-400">No tickets have exceeded their SLA threshold.</p>
                </td>
              </tr>
            ) : (
              sorted.map((t) => (
                <tr key={t.id} className="border-t border-slate-200 hover:bg-slate-50 focus-within:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-slate-700">
                    <Link href={`/helpdesk/tickets/${t.id}`} className="hover:text-indigo-600 hover:underline">
                      {t.ticketNo}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-800">{t.subject}</td>
                  <td className="px-4 py-3 text-slate-600">{t.requesterName}</td>
                  <td className="px-4 py-3">{pill(t.priority, priorityColors, t.priority)}</td>
                  <td className="px-4 py-3">{pill(t.status, statusColors, t.status)}</td>
                  <td className="px-4 py-3 text-slate-500">{t.createdAt.slice(0, 10)}</td>
                  <td className="px-4 py-3 text-slate-500">{t.assignedTo ?? "Unassigned"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
