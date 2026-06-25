"use client";

import { useState } from "react";
import type { NotificationItem } from "@civitasone/types";
import { PageHeader, StatCard, StatGrid, DataTable, Segmented, EmptyState } from "../../../_components/ds";
import { useOfflineResource } from "@/lib/sync/resource";
import { formatIndianDate } from "@/lib/formatters";
import { StatusBadge } from "../_components/StatusBadge";

type NotifRow = {
  id: string;
  title: string;
  module: string;
  recipient: string;
  channel: string;
  status: string;
  createdAt: string;
} & Record<string, unknown>;

function toArray(payload: unknown): NotificationItem[] {
  if (Array.isArray(payload)) return payload as NotificationItem[];
  if (payload && typeof payload === "object") {
    const rec = payload as Record<string, unknown>;
    if (Array.isArray(rec.data)) return rec.data as NotificationItem[];
    if (Array.isArray(rec.items)) return rec.items as NotificationItem[];
  }
  return [];
}

const TABS = ["All", "Unread", "Failed"] as const;

export default function NotificationsListPage() {
  const { data: notifications, source, offline, cachedAt, loading } = useOfflineResource<unknown, NotificationItem[]>(
    "notifications.list",
    "/notification/notifications",
    { map: toArray, initialData: [] },
  );

  const [tab, setTab] = useState<string>("All");

  const sent = notifications.filter((n) => n.status === "sent").length;
  const failed = notifications.filter((n) => n.status === "failed").length;
  const read = notifications.filter((n) => n.status === "read").length;

  const cacheNote =
    offline || source === "cache"
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  const tableRows: NotifRow[] = notifications.map((n) => ({
    id: n.id,
    title: n.title,
    module: n.module,
    recipient: n.recipient,
    channel: n.channel.replace(/_/g, " "),
    status: n.status,
    createdAt: formatIndianDate(n.createdAt),
  }));

  const filtered =
    tab === "Unread"
      ? tableRows.filter((r) => r.status !== "read")
      : tab === "Failed"
        ? tableRows.filter((r) => r.status === "failed")
        : tableRows;

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="All notification events across the platform."
        actions={
          <>
            <a className="btn ghost" href="/notifications/templates">Templates</a>
            <a className="btn ghost" href="/notifications/deliveries">Deliveries</a>
            <a className="btn ghost" href="/tenant-admin/notifications">Settings</a>
            <a className="btn primary" href="/notifications/compose">Send notification</a>
          </>
        }
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
          <div role="group" aria-label="Filter notifications by status">
            <Segmented options={[...TABS]} value={tab} onChange={setTab} />
          </div>
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
          <DataTable<NotifRow>
            columns={[
              { key: "title", label: "Title" },
              { key: "module", label: "Module" },
              { key: "recipient", label: "Recipient" },
              { key: "channel", label: "Channel" },
              { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
              { key: "createdAt", label: "Created At" },
            ]}
            rows={filtered}
            sortable
            filterable
            filterPlaceholder="Filter notifications…"
            pageSize={15}
          />
        )}
      </div>
    </>
  );
}
