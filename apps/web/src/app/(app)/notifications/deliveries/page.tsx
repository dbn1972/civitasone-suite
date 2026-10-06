"use client";

import { useState } from "react";
import type { NotificationDelivery } from "@civitasone/types";
import { PageHeader, StatCard, StatGrid, DataTable, Segmented, EmptyState, ErrorState } from "../../../_components/ds";
import { useOfflineResource } from "@/lib/sync/resource";
import { toHumanError } from "@/lib/messages";
import { formatIndianDate, maskRecipient } from "@/lib/formatters";
import { StatusBadge } from "../_components/StatusBadge";
import { isInDeliveryGroup } from "../_components/deliveryStatus";

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

/** Tiles show "—" (not a fabricated 0) while the first load is in flight or errored. */
function tileValue(count: number, loading: boolean, error: boolean): string {
  if (loading || error) return "—";
  return count.toLocaleString("en-IN");
}

export default function NotificationDeliveriesPage() {
  const { data: deliveries, source, offline, cachedAt, loading, error, refresh } = useOfflineResource<unknown, NotificationDelivery[]>(
    "notifications.deliveries",
    "/notification/deliveries",
    { map: toArray, initialData: [] },
  );

  const [tab, setTab] = useState<string>("All");

  // DELIVERIES-02: count by status GROUP (delivered=delivered|sent,
  // pending=pending|queued, failed=failed|bounced) so bounced/queued/sent rows
  // land in a tile instead of only Total.
  const delivered = deliveries.filter((d) => isInDeliveryGroup(d.status, "delivered")).length;
  const failed = deliveries.filter((d) => isInDeliveryGroup(d.status, "failed")).length;
  const pending = deliveries.filter((d) => isInDeliveryGroup(d.status, "pending")).length;

  const cacheNote =
    offline || source === "cache"
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  const tableRows: DeliveryRow[] = deliveries.map((d) => ({
    id: d.id,
    notificationTitle: d.notificationTitle,
    // DELIVERIES-01 (DPDP): recipient email/phone is personal data — mask by
    // default in the log. No reveal control: notification-service exposes no
    // audited PII-reveal endpoint (see lib/formatters.maskRecipient / ds Masked).
    recipient: maskRecipient(d.recipient),
    channel: d.channel.replace(/_/g, " "),
    attemptCount: d.attemptCount,
    deliveredAt: d.deliveredAt ? formatIndianDate(d.deliveredAt) : "—",
    status: d.status,
  }));

  // DELIVERIES-02: tab filters use the same status groups as the tiles.
  const filtered =
    tab === "Failed"
      ? tableRows.filter((r) => isInDeliveryGroup(r.status, "failed"))
      : tab === "Pending"
        ? tableRows.filter((r) => isInDeliveryGroup(r.status, "pending"))
        : tableRows;

  return (
    <>
      <PageHeader
        title="Notification Deliveries"
        subtitle="Delivery log for all outgoing notifications. Select a row to view delivery status and resend failures."
        back="/notifications"
        backLabel="Notifications"
        actions={
          <>
            <a className="btn primary" href="/notifications/compose">Send notification</a>
            <a className="btn ghost" href="/notifications/templates">Templates</a>
          </>
        }
      />
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>
          {cacheNote}
        </p>
      ) : null}
      <StatGrid>
        <StatCard icon="📤" iconBg="#eef2ff" label="Total" value={tileValue(deliveries.length, loading, !!error)} />
        <StatCard icon="✅" iconBg="#ecfdf5" label="Delivered" value={tileValue(delivered, loading, !!error)} />
        <StatCard icon="❌" iconBg="#fef2f2" label="Failed" value={tileValue(failed, loading, !!error)} />
        <StatCard icon="⏳" iconBg="#fffbeb" label="Pending" value={tileValue(pending, loading, !!error)} />
      </StatGrid>
      <div className="card">
        <div className="card-h">
          <h3>Delivery log</h3>
          <div role="group" aria-label="Filter deliveries by status">
            <Segmented options={[...TABS]} value={tab} onChange={setTab} />
          </div>
        </div>
        {error ? (
          <ErrorState error={toHumanError("load", { area: "delivery log" })} onRetry={refresh} />
        ) : deliveries.length === 0 ? (
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
              { key: "deliveredAt", label: "Delivered" },
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
