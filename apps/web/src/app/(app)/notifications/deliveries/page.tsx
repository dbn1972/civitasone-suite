import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getNotificationDeliveries } from "../../../_data/loaders";

const channelColors: Record<string, string> = {
  email: "bg-blue-50 text-blue-700",
  sms: "bg-emerald-50 text-emerald-700",
  in_app: "bg-purple-50 text-purple-700",
  webhook: "bg-orange-50 text-orange-700",
};

const statusColors: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700",
  delivered: "bg-emerald-50 text-emerald-700",
  failed: "bg-red-50 text-red-700",
  bounced: "bg-orange-50 text-orange-700",
};

export default async function NotificationDeliveriesPage() {
  const { data: deliveries, source } = await getNotificationDeliveries();

  const total = deliveries.length;
  const delivered = deliveries.filter((d) => d.status === "delivered").length;
  const failed = deliveries.filter((d) => d.status === "failed").length;
  const pending = deliveries.filter((d) => d.status === "pending").length;

  return (
    <main className="min-h-screen bg-slate-50 p-6 md:p-8">
      <section className="mx-auto max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-600">
          <Link href="/notifications" className="hover:text-slate-900">Notifications</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Deliveries</span>
        </nav>

        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Notification Deliveries</h1>
            <p className="mt-1 text-sm text-slate-600">Delivery log for all outgoing notifications.</p>
          </div>
          {source === "error" ? <DataSourceBadge source={source} /> : null}
        </header>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Total</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{total}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Delivered</p>
            <p className="mt-1 text-2xl font-bold text-emerald-600">{delivered}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Failed</p>
            <p className="mt-1 text-2xl font-bold text-red-600">{failed}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">Pending</p>
            <p className="mt-1 text-2xl font-bold text-amber-600">{pending}</p>
          </div>
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-4 py-3">Notification Title</th>
                <th className="px-4 py-3">Recipient</th>
                <th className="px-4 py-3">Channel</th>
                <th className="px-4 py-3 text-center">Attempts</th>
                <th className="px-4 py-3">Delivered At</th>
                <th className="px-4 py-3">Failure Reason</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                    No delivery records found
                  </td>
                </tr>
              ) : (
                deliveries.map((d) => (
                  <tr key={d.id} className="border-t border-slate-200 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{d.notificationTitle}</td>
                    <td className="px-4 py-3 text-slate-600">{d.recipient}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${channelColors[d.channel] ?? "bg-slate-100 text-slate-600"}`}>
                        {d.channel.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-slate-600">{d.attemptCount}</td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{d.deliveredAt ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600 max-w-xs truncate" title={d.failureReason}>
                      {(d.status === "failed" || d.status === "bounced") && d.failureReason
                        ? d.failureReason
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${statusColors[d.status] ?? "bg-slate-100 text-slate-600"}`}>
                        {d.status}
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
