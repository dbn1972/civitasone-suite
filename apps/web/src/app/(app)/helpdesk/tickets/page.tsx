import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageShell } from "../../../_components/PageShell";
import { getHelpdeskTicketList } from "../../../_data/loaders";
import type { TicketDetail } from "@civitasone/types";

const priorityColors: Record<TicketDetail["priority"], string> = {
  low: "bg-slate-100 text-slate-600",
  medium: "bg-blue-50 text-blue-700",
  high: "bg-orange-50 text-orange-700",
  critical: "bg-red-50 text-red-700",
};

const slaColors: Record<TicketDetail["slaStatus"], string> = {
  within_sla: "bg-emerald-50 text-emerald-700",
  due_soon: "bg-amber-50 text-amber-700",
  breached: "bg-red-50 text-red-700",
};

const statusColors: Record<TicketDetail["status"], string> = {
  open: "bg-blue-50 text-blue-700",
  in_progress: "bg-amber-50 text-amber-700",
  pending: "bg-orange-50 text-orange-700",
  resolved: "bg-emerald-50 text-emerald-700",
  closed: "bg-slate-100 text-slate-500",
};

function pill(label: string, colorClass: string) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${colorClass}`}>
      {label.replace(/_/g, " ")}
    </span>
  );
}

export default async function Page() {
  const { data: tickets, source } = await getHelpdeskTicketList();

  const total = tickets.length;
  const open = tickets.filter((t) => t.status === "open" || t.status === "in_progress").length;
  const breached = tickets.filter((t) => t.slaStatus === "breached").length;
  const resolved = tickets.filter((t) => t.status === "resolved").length;

  const stats = [
    { label: "Total Tickets", value: total.toLocaleString("en-IN") },
    { label: "Open", value: open.toLocaleString("en-IN") },
    { label: "SLA Breached", value: breached.toLocaleString("en-IN") },
    { label: "Resolved Today", value: resolved.toLocaleString("en-IN") },
  ];

  return (
    <PageShell title="Citizen Tickets" description="Citizen-facing support queue via citizen-service.">
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
              <th className="px-4 py-3 text-left">Ticket No</th>
              <th className="px-4 py-3 text-left">Subject</th>
              <th className="px-4 py-3 text-left">Requester</th>
              <th className="px-4 py-3 text-left">Priority</th>
              <th className="px-4 py-3 text-left">SLA Status</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Created</th>
              <th className="px-4 py-3 text-left">Channel</th>
            </tr>
          </thead>
          <tbody>
            {tickets.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-400">No tickets</td>
              </tr>
            ) : (
              tickets.map((t) => (
                <tr key={t.id} className="border-t border-slate-200 hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-slate-700">
                    <Link href={`/helpdesk/tickets/${t.id}`} className="hover:text-indigo-600 hover:underline">
                      {t.ticketNo}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-800">{t.subject}</td>
                  <td className="px-4 py-3 text-slate-600">{t.requesterName}</td>
                  <td className="px-4 py-3">{pill(t.priority, priorityColors[t.priority])}</td>
                  <td className="px-4 py-3">{pill(t.slaStatus, slaColors[t.slaStatus])}</td>
                  <td className="px-4 py-3">{pill(t.status, statusColors[t.status])}</td>
                  <td className="px-4 py-3 text-slate-500">{t.createdAt.slice(0, 10)}</td>
                  <td className="px-4 py-3 text-slate-500">{t.channel ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
