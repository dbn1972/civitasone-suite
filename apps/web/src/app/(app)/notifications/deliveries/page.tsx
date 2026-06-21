import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageShell } from "../../../_components/PageShell";
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

function pill(label: string, colors: Record<string, string>, key: string) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${colors[key] ?? "bg-slate-100 text-slate-600"}`}>
      {label.replace(/_/g, " ")}
    </span>
  );
}

export default async function NotificationDeliveriesPage() {
  const { data: deliveries, source } = await getNotificationDeliveries();

  const total = deliveries.length;
  const delivered = deliveries.filter((d) => d.status === "delivered").length;
  const failed = deliveries.filter((d) => d.status === "failed").length;
  const pending = deliveries.filter((d) => d.status === "pending").length;

  const stats = [
    { label: "Total", value: total.toLocaleString("en-IN"), color: "text-slate-900" },
    { label: "Delivered", value: delivered.toLocaleString("en-IN"), color: "text-emerald-600" },
    { label: "Failed", value: failed.toLocaleString("en-IN"), color: "text-red-600" },
    { label: "Pending", value: pending.toLocaleString("en-IN"), color: "text-amber-600" },
  ];

  return (
    <PageShell
      title="Notification Deliveries"
      description="Delivery log for all outgoing notifications."
      breadcrumb={
        <>
          <Link href="/notifications" className="hover:text-slate-900">Notifications</Link>
          <span className="mx-2">/</span>
          <span className="text-slate-900">Deliveries</span>
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
        <table className="min-w-full text-sm" aria-label="Notification delivery log">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              <th scope="col" className="px-4 py-3 text-left">Notification Title</th>
              <th scope="col" className="px-4 py-3 text-left">Recipient</th>
              <th scope="col" className="px-4 py-3 text-left">Channel</th>
              <th scope="col" className="px-4 py-3 text-center">Attempts</th>
              <th scope="col" className="px-4 py-3 text-left">Delivered At</th>
              <th scope="col" className="px-4 py-3 text-left">Failure Reason</th>
              <th scope="col" className="px-4 py-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {deliveries.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center">
                  <p className="text-slate-500 font-medium">No delivery records</p>
                  <p className="mt-1 text-sm text-slate-400">Delivery logs will appear here once notifications are sent.</p>
                </td>
              </tr>
            ) : (
              deliveries.map((d) => (
                <tr key={d.id} className="border-t border-slate-200 hover:bg-slate-50 focus-within:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">{d.notificationTitle}</td>
                  <td className="px-4 py-3 text-slate-600">{d.recipient}</td>
                  <td className="px-4 py-3">{pill(d.channel, channelColors, d.channel)}</td>
                  <td className="px-4 py-3 text-center text-slate-600">{d.attemptCount}</td>
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{d.deliveredAt ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600 max-w-xs truncate" title={d.failureReason ?? undefined}>
                    {(d.status === "failed" || d.status === "bounced") && d.failureReason
                      ? d.failureReason
                      : "—"}
                  </td>
                  <td className="px-4 py-3">{pill(d.status, statusColors, d.status)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
