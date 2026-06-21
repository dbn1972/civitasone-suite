import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageShell } from "../../../_components/PageShell";
import { getNotifications } from "../../../_data/loaders";

const channelColors: Record<string, string> = {
  email: "bg-blue-50 text-blue-700",
  sms: "bg-emerald-50 text-emerald-700",
  in_app: "bg-purple-50 text-purple-700",
  webhook: "bg-orange-50 text-orange-700",
};

const statusColors: Record<string, string> = {
  sent: "bg-emerald-50 text-emerald-700",
  pending: "bg-amber-50 text-amber-700",
  failed: "bg-red-50 text-red-700",
  read: "bg-slate-100 text-slate-500",
};

function pill(label: string, colors: Record<string, string>, key: string) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${colors[key] ?? "bg-slate-100 text-slate-600"}`}>
      {label.replace(/_/g, " ")}
    </span>
  );
}

export default async function NotificationsListPage() {
  const { data: notifications, source } = await getNotifications();

  const total = notifications.length;
  const sent = notifications.filter((n) => n.status === "sent").length;
  const failed = notifications.filter((n) => n.status === "failed").length;
  const read = notifications.filter((n) => n.status === "read").length;

  const stats = [
    { label: "Total", value: total.toLocaleString("en-IN"), color: "text-slate-900" },
    { label: "Sent", value: sent.toLocaleString("en-IN"), color: "text-emerald-600" },
    { label: "Failed", value: failed.toLocaleString("en-IN"), color: "text-red-600" },
    { label: "Read", value: read.toLocaleString("en-IN"), color: "text-slate-500" },
  ];

  return (
    <PageShell
      title="Notifications"
      description="All notification events across the platform."
      breadcrumb={
        <>
          <Link href="/notifications" className="hover:text-slate-900">Notifications</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Inbox</span>
        </>
      }
    >
      {source === "error" ? <DataSourceBadge source={source} /> : null}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs text-slate-500">{s.label}</p>
            <p className={`mt-1 text-2xl font-semibold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm" aria-label="Notifications inbox">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              <th scope="col" className="px-4 py-3 text-left">Title</th>
              <th scope="col" className="px-4 py-3 text-left">Message</th>
              <th scope="col" className="px-4 py-3 text-left">Module</th>
              <th scope="col" className="px-4 py-3 text-left">Event Type</th>
              <th scope="col" className="px-4 py-3 text-left">Recipient</th>
              <th scope="col" className="px-4 py-3 text-left">Channel</th>
              <th scope="col" className="px-4 py-3 text-left">Status</th>
              <th scope="col" className="px-4 py-3 text-left">Created At</th>
              <th scope="col" className="px-4 py-3 text-left">Read At</th>
            </tr>
          </thead>
          <tbody>
            {notifications.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center">
                  <p className="text-slate-500 font-medium">No notifications yet</p>
                  <p className="mt-1 text-sm text-slate-400">Notifications from platform events will appear here.</p>
                </td>
              </tr>
            ) : (
              notifications.map((n) => (
                <tr key={n.id} className="border-t border-slate-200 hover:bg-slate-50 focus-within:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap">{n.title}</td>
                  <td className="px-4 py-3 text-slate-600 max-w-xs truncate" title={n.message}>
                    {n.message}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{n.module}</td>
                  <td className="px-4 py-3 text-slate-600">{n.eventType}</td>
                  <td className="px-4 py-3 text-slate-600">{n.recipient}</td>
                  <td className="px-4 py-3">{pill(n.channel, channelColors, n.channel)}</td>
                  <td className="px-4 py-3">{pill(n.status, statusColors, n.status)}</td>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{n.createdAt}</td>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{n.readAt ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
