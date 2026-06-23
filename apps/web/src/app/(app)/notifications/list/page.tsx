"use client";

import type { NotificationItem } from "@civitasone/types";
import { PageHeader, StatCard, StatGrid, StatusPill, EmptyState } from "../../../_components/ds";
import { useOfflineResource } from "@/lib/sync/resource";

function toArray(payload: unknown): NotificationItem[] {
  if (Array.isArray(payload)) return payload as NotificationItem[];
  if (payload && typeof payload === "object") {
    const rec = payload as Record<string, unknown>;
    if (Array.isArray(rec.data)) return rec.data as NotificationItem[];
    if (Array.isArray(rec.items)) return rec.items as NotificationItem[];
  }
  return [];
}

export default function NotificationsListPage() {
  const { data: notifications, source, offline, cachedAt, loading } = useOfflineResource<unknown, NotificationItem[]>(
    "notifications.list",
    "/notification/notifications",
    { map: toArray, initialData: [] },
  );

  const sent = notifications.filter((n) => n.status === "sent").length;
  const failed = notifications.filter((n) => n.status === "failed").length;
  const read = notifications.filter((n) => n.status === "read").length;

  const cacheNote =
    offline || source === "cache"
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="All notification events across the platform."
        actions={<button className="btn ghost">Settings</button>}
      />
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>
          {cacheNote}
        </p>
      ) : null}
      <StatGrid>
        <StatCard icon="🔔" iconBg="#eef2ff" label="Total" value={notifications.length.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="#ecfdf5" label="Sent" value={sent.toLocaleString("en-IN")} />
        <StatCard icon="❌" iconBg="#fef2f2" label="Failed" value={failed.toLocaleString("en-IN")} />
        <StatCard icon="👁" iconBg="#f8fafc" label="Read" value={read.toLocaleString("en-IN")} />
      </StatGrid>
      <div className="card">
        <div className="card-h">
          <h3>Notifications</h3>
          <div className="seg"><span className="on">All</span><span>Unread</span><span>Failed</span></div>
        </div>
        {notifications.length === 0 ? (
          <EmptyState
            icon="🔔"
            title={loading ? "Loading notifications…" : "No notifications yet"}
            message={
              loading
                ? "Fetching the latest notifications."
                : "Notifications from platform events will appear here."
            }
          />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Title</th>
                <th>Module</th>
                <th>Recipient</th>
                <th>Channel</th>
                <th>Status</th>
                <th>Created At</th>
              </tr>
            </thead>
            <tbody>
              {notifications.map((n) => (
                <tr key={n.id}>
                  <td style={{ fontWeight: 500 }}>{n.title}</td>
                  <td>{n.module}</td>
                  <td>{n.recipient}</td>
                  <td><StatusPill status={n.channel} label={n.channel.replace(/_/g, " ")} /></td>
                  <td><StatusPill status={n.status} /></td>
                  <td style={{ whiteSpace: "nowrap" }}>{n.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
