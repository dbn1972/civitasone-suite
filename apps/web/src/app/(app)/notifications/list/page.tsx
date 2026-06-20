import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
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

export default async function NotificationsListPage() {
  const { data: notifications, source } = await getNotifications();

  const total = notifications.length;
  const sent = notifications.filter((n) => n.status === "sent").length;
  const failed = notifications.filter((n) => n.status === "failed").length;
  const read = notifications.filter((n) => n.status === "read").length;

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/notifications" className="hover:text-slate-900">Notifications</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Inbox</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Notifications</h1>
            <p className="mt-1 text-sm text-slate-600">All notification events across the platform.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{total}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Sent</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">{sent}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Failed</p>
            <p className="mt-1 text-2xl font-bold text-red-600">{failed}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Read</p>
            <p className="mt-1 text-2xl font-bold text-slate-500">{read}</p>
          </div>
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Message</th>
                <th className="px-4 py-3">Module</th>
                <th className="px-4 py-3">Event Type</th>
                <th className="px-4 py-3">Recipient</th>
                <th className="px-4 py-3">Channel</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created At</th>
                <th className="px-4 py-3">Read At</th>
              </tr>
            </thead>
            <tbody>
              {notifications.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                    No notifications found
                  </td>
                </tr>
              ) : (
                notifications.map((n) => (
                  <tr key={n.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap">{n.title}</td>
                    <td className="px-4 py-3 text-slate-600 max-w-xs truncate" title={n.message}>
                      {n.message}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{n.module}</td>
                    <td className="px-4 py-3 text-slate-600">{n.eventType}</td>
                    <td className="px-4 py-3 text-slate-600">{n.recipient}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${channelColors[n.channel] ?? "bg-slate-100 text-slate-600"}`}>
                        {n.channel.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[n.status] ?? "bg-slate-100 text-slate-600"}`}>
                        {n.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{n.createdAt}</td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{n.readAt ?? "—"}</td>
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
