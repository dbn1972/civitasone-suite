import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getHelpdeskTicketById } from "../../../../_data/loaders";

const priorityColors: Record<string, string> = {
  low: "bg-slate-100 text-slate-600",
  medium: "bg-blue-50 text-blue-700",
  high: "bg-orange-50 text-orange-700",
  critical: "bg-red-50 text-red-700",
};

const slaColors: Record<string, string> = {
  within_sla: "bg-emerald-50 text-emerald-700",
  due_soon: "bg-amber-50 text-amber-700",
  breached: "bg-red-50 text-red-700",
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

export default async function Page({ params }: { params: { id: string } }) {
  const { data: ticket, source } = await getHelpdeskTicketById(params.id);

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-4xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/helpdesk" className="hover:text-slate-900">Helpdesk</Link>
          <span className="mx-2">/</span>
          <Link href="/helpdesk/tickets" className="hover:text-slate-900">Tickets</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">{ticket?.ticketNo ?? params.id}</span>
        </nav>

        <header className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold text-slate-900">Ticket Detail</h1>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        {ticket ? (
          <div className="space-y-5">
            <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-sm text-slate-500">{ticket.ticketNo}</p>
                  <h2 className="mt-1 text-xl font-semibold text-slate-900">{ticket.subject}</h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  {pill(ticket.priority, priorityColors, ticket.priority)}
                  {pill(ticket.slaStatus, slaColors, ticket.slaStatus)}
                  {pill(ticket.status, statusColors, ticket.status)}
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 md:grid-cols-3">
                <div>
                  <p className="text-xs text-slate-500">Requester</p>
                  <p className="mt-1 text-slate-800">{ticket.requesterName}</p>
                  {ticket.requesterEmail && (
                    <p className="text-xs text-slate-500">{ticket.requesterEmail}</p>
                  )}
                </div>
                <div>
                  <p className="text-xs text-slate-500">Assigned To</p>
                  <p className="mt-1 text-slate-800">{ticket.assignedTo ?? "Unassigned"}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Channel</p>
                  <p className="mt-1 text-slate-800">{ticket.channel ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Created</p>
                  <p className="mt-1 text-slate-800">{ticket.createdAt.slice(0, 10)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Updated</p>
                  <p className="mt-1 text-slate-800">{ticket.updatedAt.slice(0, 10)}</p>
                </div>
                {ticket.resolvedAt && (
                  <div>
                    <p className="text-xs text-slate-500">Resolved</p>
                    <p className="mt-1 text-slate-800">{ticket.resolvedAt.slice(0, 10)}</p>
                  </div>
                )}
              </div>
            </section>

            {ticket.description && (
              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-2 text-sm font-semibold text-slate-800">Description</div>
                <p className="text-sm text-slate-700 whitespace-pre-wrap">{ticket.description}</p>
              </section>
            )}

            {ticket.comments.length > 0 && (
              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-3 text-sm font-semibold text-slate-800">Comments / Timeline</div>
                <div className="space-y-4">
                  {ticket.comments.map((c) => (
                    <div key={c.id} className={`rounded-lg border p-4 ${c.isInternal ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}>
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-sm font-medium text-slate-800">{c.author}</span>
                        <div className="flex items-center gap-2">
                          {c.isInternal && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">Internal</span>
                          )}
                          <span className="text-xs text-slate-400">{c.createdAt.slice(0, 10)}</span>
                        </div>
                      </div>
                      <p className="text-sm text-slate-700">{c.content}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white py-12 text-center text-slate-400 shadow-sm">
            Ticket not found
          </div>
        )}
      </section>
    </main>
  );
}
