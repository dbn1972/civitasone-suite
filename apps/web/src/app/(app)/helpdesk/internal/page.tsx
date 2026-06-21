import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageShell } from "../../../_components/PageShell";
import { getInternalHelpdeskTickets } from "../../../_data/loaders";

const priorityColors: Record<string, string> = {
  Low: "bg-slate-100 text-slate-600",
  Medium: "bg-blue-50 text-blue-700",
  High: "bg-orange-50 text-orange-700",
  Critical: "bg-red-50 text-red-700",
};

const statusColors: Record<string, string> = {
  Open: "bg-blue-50 text-blue-700",
  "In Progress": "bg-amber-50 text-amber-700",
  Resolved: "bg-emerald-50 text-emerald-700",
  Closed: "bg-slate-100 text-slate-500",
};

function pill(label: string, colors: Record<string, string>) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${colors[label] ?? "bg-slate-100 text-slate-600"}`}>
      {label}
    </span>
  );
}

export default async function Page() {
  const { data: tickets, source } = await getInternalHelpdeskTickets();

  const open = tickets.filter((t) => t.status === "Open" || t.status === "In Progress").length;
  const resolved = tickets.filter((t) => t.status === "Resolved").length;
  const critical = tickets.filter((t) => t.priority === "Critical").length;

  const stats = [
    { label: "Total Tickets", value: tickets.length.toLocaleString("en-IN") },
    { label: "Open", value: open.toLocaleString("en-IN") },
    { label: "Resolved", value: resolved.toLocaleString("en-IN") },
    { label: "Critical", value: critical.toLocaleString("en-IN") },
  ];

  return (
    <PageShell
      title="Internal Helpdesk Tickets"
      description="Staff operations queue via helpdesk-service."
      breadcrumb={
        <>
          <Link href="/helpdesk" className="hover:text-slate-900">Helpdesk</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Internal</span>
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
        <table className="min-w-full text-sm" aria-label="Internal helpdesk tickets">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              <th scope="col" className="px-4 py-3 text-left">Ticket</th>
              <th scope="col" className="px-4 py-3 text-left">Subject</th>
              <th scope="col" className="px-4 py-3 text-left">Priority</th>
              <th scope="col" className="px-4 py-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {tickets.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center">
                  <p className="text-slate-500 font-medium">No internal tickets</p>
                  <p className="mt-1 text-sm text-slate-400">Staff tickets will appear here once submitted.</p>
                </td>
              </tr>
            ) : (
              tickets.map((t) => (
                <tr key={t.id} className="border-t border-slate-200 hover:bg-slate-50 focus-within:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-slate-700">{t.id}</td>
                  <td className="px-4 py-3 text-slate-800">{t.subject}</td>
                  <td className="px-4 py-3">{pill(t.priority, priorityColors)}</td>
                  <td className="px-4 py-3">{pill(t.status, statusColors)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
