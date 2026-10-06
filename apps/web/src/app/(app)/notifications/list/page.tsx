"use client";

import { useState } from "react";
import Link from "next/link";
import type { NotificationItem } from "@civitasone/types";
import { PageHeader, StatCard, StatGrid, DataTable, Segmented, EmptyState, ErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import type { DataProvenance } from "@/lib/sync/resource";
import { useOfflineResource } from "@/lib/sync/resource";
import { toHumanError } from "@/lib/messages";
import { formatIndianDateTime, maskRecipient } from "@/lib/formatters";
import { StatusBadge } from "../_components/StatusBadge";
import { bucketCounts, isUnread } from "../_components/classifyStatus";

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

const HEADER_LINKS = [
  { href: "/notifications/templates", label: "Templates", variant: "ghost" },
  { href: "/notifications/deliveries", label: "Deliveries", variant: "ghost" },
  { href: "/tenant-admin/notifications", label: "Settings", variant: "ghost" },
  { href: "/notifications/compose", label: "Send notification", variant: "primary" },
] as const;

export default function NotificationsListPage() {
  const { data: notifications, source, offline, cachedAt, loading, error, refresh } = useOfflineResource<unknown, NotificationItem[]>(
    "notifications.list",
    "/notification/notifications",
    { map: toArray, initialData: [] },
  );

  const [tab, setTab] = useState<string>("All");

  // GAP-NOTIFICATIONS-LIST-02: counts come from one shared classifier so the
  // tiles always sum to Total and failed/queued events are not miscounted.
  const counts = bucketCounts(notifications.map((n) => n.status));

  // GAP-NOTIFICATIONS-LIST-03: never render a fabricated 0 while loading or on
  // error — show "—" so the clerk doesn't read a failed/pending fetch as an
  // empty inbox. (These counts describe this page of results; see HUMAN REVIEW
  // on server-side aggregate totals.)
  const unknown = loading || Boolean(error);
  const stat = (n: number) => (unknown ? "—" : n.toLocaleString("en-IN"));

  // GAP-NOTIFICATIONS-LIST-04: one provenance value, derived from the SAME hook
  // call the table renders from, drives the badge — no second, separately
  // derived cache note that could disagree. Hidden entirely when the error
  // state is shown (we don't claim "saved data" and "couldn't load" at once).
  const provenance: DataProvenance = error && notifications.length === 0 // ux-001-ok: this IS the error branch (error is checked first); length only distinguishes error-no-data from error-with-stale-rows, never renders an empty state
    ? "error-no-data"
    : offline || source === "cache"
      ? "cached"
      : "live";

  const tableRows: NotifRow[] = notifications.map((n) => ({
    id: n.id,
    title: n.title,
    module: n.module,
    // GAP-NOTIFICATIONS-LIST-01: recipient is DPDP personal data — never printed verbatim.
    recipient: maskRecipient(n.recipient),
    channel: n.channel.replace(/_/g, " "),
    status: n.status,
    // GAP-NOTIFICATIONS-LIST-05: show date AND time — inbox events can be minutes old.
    createdAt: formatIndianDateTime(n.createdAt),
  }));

  const filtered =
    tab === "Unread"
      ? tableRows.filter((r) => isUnread(r.status))
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
            {HEADER_LINKS.map((l) => (
              <Link key={l.href} className={`btn ${l.variant}`} href={l.href}>
                {l.label}
              </Link>
            ))}
          </>
        }
      />
      {!error ? <DataSourceBadge provenance={provenance} cachedAt={cachedAt} offline={offline} /> : null}
      <StatGrid>
        <StatCard icon="🔔" iconBg="#eef2ff" label="Total" value={stat(counts.total)} />
        <StatCard icon="✅" iconBg="#ecfdf5" label="Delivered" value={stat(counts.delivered)} />
        <StatCard icon="❌" iconBg="#fef2f2" label="Failed" value={stat(counts.failed)} />
        <StatCard icon="⏳" iconBg="#fffbeb" label="In progress" value={stat(counts.inProgress)} />
      </StatGrid>
      <div className="card">
        <div className="card-h">
          <h3>Notifications</h3>
          <div role="group" aria-label="Filter notifications by status">
            <Segmented options={[...TABS]} value={tab} onChange={setTab} />
          </div>
        </div>
        {error ? (
          <ErrorState error={toHumanError("load", { area: "notifications" })} onRetry={refresh} />
        ) : notifications.length === 0 ? (
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
            rowHref={(r) => `/notifications/deliveries/${r.id}`}
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
