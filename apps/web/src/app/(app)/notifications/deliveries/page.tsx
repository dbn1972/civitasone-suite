"use client";

import { useState } from "react";
import type { NotificationDelivery } from "@civitasone/types";
import { PageHeader, StatCard, StatGrid, DataTable, Segmented, EmptyState } from "../../../_components/ds";
import { useOfflineResource } from "@/lib/sync/resource";
import { formatIndianDate } from "@/lib/formatters";
import { StatusBadge } from "../_components/StatusBadge";

type DeliveryRow = {
  id: string;
  notificationTitle: string;
  recipient: string;
  channel: string;
  attemptCount: number;
  deliveredAt: string;
  status: string;
} & Record<string, unknown>;

function toArray(payload: unknown): NotificationDelivery[] {
  if (Array.isArray(payload)) return payload as NotificationDelivery[];
  if (payload && typeof payload === "object") {
    const rec = payload as Record<string, unknown>;
    if (Array.isArray(rec.data)) return rec.data as NotificationDelivery[];
    if (Array.isArray(rec.items)) return rec.items as NotificationDelivery[];
  }
  return [];
}

const TABS = ["All", "Failed", "Pending"] as const;

export default function NotificationDeliveriesPage() {
  const { data: deliveries, source, offline, cachedAt, loading } = useOfflineResource<unknown, NotificationDelivery[]>(
    "notifications.deliveries",
    "/notification/deliveries",
    { map: toArray, initialData: [] },
  );

  const [tab, setTab] = useState<string>("All");

  const delivered = deliveries.filter((d) => d.status === "delivered").length;
  const failed = deliveries.filter((d) => d.status === "failed").length;
  const pending = deliveries.filter((d) => d.status === "pending").length;

  const cacheNote =
    offline || source === "cache"
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  const tableRows: DeliveryRow[] = deliveries.map((d) => ({
    id: d.id,
    notificationTitle: d.notificationTitle,
    recipient: d.recipient,
    channel: d.channel.replace(/_/g, " "),
    attemptCount: d.attemptCount,
    deliveredAt: d.deliveredAt ? formatIndianDate(d.deliveredAt) : "—",
    status: d.status,
  }));

  const filtered =
    tab === "Failed"
      ? tableRows.filter((r) => r.status === "failed")
      : tab === "Pending"
        ? tableRows.filter((r) => r.status === "pending")
        : tableRows;

  return (
    <>
      <PageHeader
        title="Notification Deliveries"
        subtitle="Delivery log for all outgoing notifications. Select a row to view delivery status and resend failures."
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
          <div role="group" aria-label="Filter deliveries by status">
            <Segmented options={[...TABS]} value={tab} onChange={setTab} />
          </div>
        </div>
        {deliveries.length === 0 ? (
          <EmptyState
            icon="📤"
            title={loading ? "Loading deliveries…" : "No delivery records"}
            message={loading ? "Fetching the delivery log." : "Delivery logs will appear here once notifications are sent."}
          />
        ) : (
          <DataTable<DeliveryRow>
            columns={[
              { key: "notificationTitle", label: "Notification" },
              { key: "recipient", label: "Recipient" },
              { key: "channel", label: "Channel" },
              { key: "attemptCount", label: "Attempts", align: "right" },
              { key: "deliveredAt", label: "Delivered At" },
              { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
            ]}
            rows={filtered}
            rowHref={(r) => `/notifications/deliveries/${r.id}`}
            sortable
            filterable
            filterPlaceholder="Filter deliveries…"
            pageSize={15}
          />
        )}
      </div>
    </>
  );
}
