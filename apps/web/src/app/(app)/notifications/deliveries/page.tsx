"use client";

import type { NotificationDelivery } from "@civitasone/types";
import { PageHeader, StatCard, StatGrid, StatusPill, EmptyState } from "../../../_components/ds";
import { useOfflineResource } from "@/lib/sync/resource";

function toArray(payload: unknown): NotificationDelivery[] {
  if (Array.isArray(payload)) return payload as NotificationDelivery[];
  if (payload && typeof payload === "object") {
    const rec = payload as Record<string, unknown>;
    if (Array.isArray(rec.data)) return rec.data as NotificationDelivery[];
    if (Array.isArray(rec.items)) return rec.items as NotificationDelivery[];
  }
  return [];
}

export default function NotificationDeliveriesPage() {
  const { data: deliveries, source, offline, cachedAt, loading } = useOfflineResource<unknown, NotificationDelivery[]>(
    "notifications.deliveries",
    "/notification/deliveries",
    { map: toArray, initialData: [] },
  );

  const delivered = deliveries.filter((d) => d.status === "delivered").length;
  const failed = deliveries.filter((d) => d.status === "failed").length;
  const pending = deliveries.filter((d) => d.status === "pending").length;

  const cacheNote =
    offline || source === "cache"
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <>
      <PageHeader
        title="Notification Deliveries"
        subtitle="Delivery log for all outgoing notifications."
        back="/notifications/list"
      />
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>
          {cacheNote}
        </p>
      ) : null}
      <StatGrid>
        <StatCard icon="📤" iconBg="#eef2ff" label="Total" value={deliveries.length.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="#ecfdf5" label="Delivered" value={delivered.toLocaleString("en-IN")} />
        <StatCard icon="❌" iconBg="#fef2f2" label="Failed" value={failed.toLocaleString("en-IN")} />
        <StatCard icon="⏳" iconBg="#fffbeb" label="Pending" value={pending.toLocaleString("en-IN")} />
      </StatGrid>
      <div className="card">
        <div className="card-h">
          <h3>Delivery log</h3>
          <div className="seg"><span className="on">All</span><span>Failed</span><span>Pending</span></div>
        </div>
        {deliveries.length === 0 ? (
          <EmptyState
            icon="📤"
            title={loading ? "Loading deliveries…" : "No delivery records"}
            message={loading ? "Fetching the delivery log." : "Delivery logs will appear here once notifications are sent."}
          />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Notification</th>
                <th>Recipient</th>
                <th>Channel</th>
                <th style={{ textAlign: "right" }}>Attempts</th>
                <th>Delivered At</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((d) => (
                <tr key={d.id}>
                  <td style={{ fontWeight: 500 }}>{d.notificationTitle}</td>
                  <td>{d.recipient}</td>
                  <td><StatusPill status={d.channel} label={d.channel.replace(/_/g, " ")} /></td>
                  <td className="num">{d.attemptCount}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{d.deliveredAt ?? "—"}</td>
                  <td><StatusPill status={d.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
